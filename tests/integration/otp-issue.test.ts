import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { issueOtp } from "@/modules/auth-learner/otp";
import { ZaloZnsSender } from "@/modules/auth-learner/otp-sender";
import { FakeEmailSink } from "@/modules/mail/fake-sink";
import { findInDb } from "../helpers/scan";
import { ageSendLog, FailingSender, sqlAsMigrator } from "../helpers/otp";

const SEC = 1_000;
const MARGIN = 1_000;
const email = (n: number | string = 1) => `hv${n}@x.vn`;
const base = { purpose: "login" as const, kind: "email" as const, ip: "10.0.0.1", create: true };

let sink: FakeEmailSink;
let logged: string[];

beforeEach(() => {
  sink = new FakeEmailSink();
  logged = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const activeChallenges = (value: string) =>
  prisma().otpChallenge.findMany({ where: { valueCanonical: value, consumedAt: null, invalidatedAt: null } });

describe("issueOtp", () => {
  it("lần đầu → sent; một thử thách hiệu lực; DB và log không chứa mã", async () => {
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("sent");
    const [message] = sink.messages();
    expect(message).toMatchObject({ to: email(), kind: "otp" });
    const code = message!.body.match(/\b\d{6}\b/)![0];
    const challenges = await activeChallenges(email());
    expect(challenges).toHaveLength(1);
    expect(challenges[0]!.codeHmac).not.toBe(code);
    expect(challenges[0]!.codeHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(challenges[0]!.keyVersion).toBe(process.env.OTP_PEPPER_CURRENT);
    expect(await findInDb(code)).toEqual([]);
    expect(logged.join("\n")).not.toContain(code);
  });

  it("khoảng chờ 60 giây tính chung mọi purpose; hết chờ thì mã cũ bị hủy", async () => {
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("sent");
    const [first] = await activeChallenges(email());
    await ageSendLog(60 * SEC - MARGIN);
    expect(await issueOtp({ ...base, purpose: "signup", value: email() }, sink)).toBe("throttled");
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("throttled");
    await ageSendLog(MARGIN);
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("sent");
    const old = await prisma().otpChallenge.findUniqueOrThrow({ where: { id: first!.id } });
    expect(old.invalidatedAt).not.toBeNull();
    expect(await activeChallenges(email())).toHaveLength(1);
  });

  it("10 lần/24 giờ một định danh (mọi purpose cộng); lần 11 sau đúng 24 giờ kể từ lần 1 → sent", async () => {
    const purposes = ["login", "signup"] as const;
    for (let i = 0; i < 10; i++) {
      expect(await issueOtp({ ...base, purpose: purposes[i % 2]!, value: email() }, sink)).toBe("sent");
      await ageSendLog(61 * SEC);
    }
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("throttled");
    await sqlAsMigrator(
      `UPDATE otp_send_log SET sent_at = now() - interval '24 hours'
       WHERE id = (SELECT id FROM otp_send_log ORDER BY sent_at LIMIT 1)`,
    );
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("sent");
  });

  it("IP: lần 31 trong 1 giờ (định danh khác nhau) → throttled", async () => {
    for (let i = 0; i < 30; i++) expect(await issueOtp({ ...base, value: email(i) }, sink)).toBe("sent");
    expect(await issueOtp({ ...base, value: email("x") }, sink)).toBe("throttled");
    expect(await issueOtp({ ...base, value: email("x"), ip: "10.0.0.2" }, sink)).toBe("sent");
  });

  it("5 lời gọi song song cùng định danh (purpose khác nhau) → đúng 1 sent", async () => {
    const purposes = ["login", "signup", "login", "signup", "login"] as const;
    const results = await Promise.all(purposes.map((purpose) => issueOtp({ ...base, purpose, value: email() }, sink)));
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(results.filter((r) => r === "throttled")).toHaveLength(4);
    expect(await activeChallenges(email())).toHaveLength(1);
  });

  it("5 lời gọi song song khác định danh cùng IP khi còn 1 lượt IP → đúng 1 sent", async () => {
    for (let i = 0; i < 29; i++) {
      await sqlAsMigrator(
        `INSERT INTO otp_send_log (kind, value_canonical, ip, channel, outcome) VALUES ('email', $1, '10.0.0.1', 'email', 'sent')`,
        [`cu${i}@x.vn`],
      );
    }
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => issueOtp({ ...base, value: email(`p${n}`) }, sink)));
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
  });

  it("sender lỗi → delivery_failed, đánh dấu thử thách, hạn mức vẫn tính", async () => {
    const failing = new FailingSender();
    expect(await issueOtp({ ...base, value: email() }, failing)).toBe("delivery_failed");
    expect(failing.calls).toBe(1);
    const [challenge] = await activeChallenges(email());
    expect(challenge!.deliveryFailedAt).not.toBeNull();
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("throttled");
  });

  it("Zalo tắt → delivery_failed, không gửi đi đâu", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await issueOtp({ ...base, kind: "phone", value: "+84912345678" }, new ZaloZnsSender());
    expect(result).toBe("delivery_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("create=false → skipped, hạn mức có tính, không thử thách, không thư", async () => {
    expect(await issueOtp({ ...base, value: email(), create: false }, sink)).toBe("skipped");
    expect(await prisma().otpChallenge.count()).toBe(0);
    expect(sink.messages()).toHaveLength(0);
    expect(await prisma().otpSendLog.count()).toBe(1);
    expect(await issueOtp({ ...base, value: email() }, sink)).toBe("throttled");
  });

  it("purpose link gắn userId", async () => {
    const user = await prisma().user.create({ data: { displayName: "HV" } });
    expect(await issueOtp({ ...base, purpose: "link", value: email(), userId: user.id }, sink)).toBe("sent");
    expect((await activeChallenges(email()))[0]!.userId).toBe(user.id);
  });
});
