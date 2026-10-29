import { describe, expect, it, vi } from "vitest";
import { disconnectDb, prisma, withTx } from "@/lib/db";
import { issueOtp, verifyOtp, type OtpPurpose } from "@/modules/auth-learner/otp";
import { FakeEmailSink } from "@/modules/mail/fake-sink";
import { sqlAsMigrator } from "../helpers/otp";

const MIN = 60_000;
const MARGIN = 1_000;
const VALUE = "hv@x.vn";

async function issue(purpose: OtpPurpose = "login", userId?: string): Promise<string> {
  const sink = new FakeEmailSink();
  expect(await issueOtp({ purpose, kind: "email", value: VALUE, ip: "10.0.0.1", userId, create: true }, sink)).toBe("sent");
  return sink.messages()[0]!.body.match(/\b\d{6}\b/)![0];
}

const verify = (code: string, purpose: OtpPurpose = "login", userId?: string) =>
  withTx((tx) => verifyOtp(tx, { purpose, kind: "email", value: VALUE, code, userId }));

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

async function challenge() {
  return prisma().otpChallenge.findFirstOrThrow({ where: { valueCanonical: VALUE }, orderBy: { createdAt: "desc" } });
}

async function ageChallenge(ms: number) {
  await sqlAsMigrator(
    `UPDATE otp_challenges SET created_at = created_at - make_interval(secs => $1::double precision / 1000),
       expires_at = expires_at - make_interval(secs => $1::double precision / 1000)`,
    [ms],
  );
}

describe("verifyOtp", () => {
  it("đúng → ok và consumed_at; dùng lại → invalid", async () => {
    const code = await issue();
    expect(await verify(code)).toBe("ok");
    expect((await challenge()).consumedAt).not.toBeNull();
    expect(await verify(code)).toBe("invalid");
  });

  it("purpose khác → invalid", async () => {
    const code = await issue("login");
    expect(await verify(code, "signup")).toBe("invalid");
    expect(await verify(code, "login")).toBe("ok");
  });

  it("userId khác với thử thách link → invalid", async () => {
    const owner = await prisma().user.create({ data: { displayName: "Chủ" } });
    const other = await prisma().user.create({ data: { displayName: "Khác" } });
    const code = await issue("link", owner.id);
    expect(await verify(code, "link", other.id)).toBe("invalid");
    expect(await verify(code, "link")).toBe("invalid");
    expect(await verify(code, "link", owner.id)).toBe("ok");
  });

  it("5 lần sai → lần 6 kể cả đúng là invalid, thử thách bị hủy", async () => {
    const code = await issue();
    for (let i = 0; i < 5; i++) expect(await verify(wrong(code))).toBe("invalid");
    expect(await verify(code)).toBe("invalid");
    const c = await challenge();
    expect(c.attempts).toBe(5);
    expect(c.invalidatedAt).not.toBeNull();
  });

  it("4 lần sai rồi đúng → ok", async () => {
    const code = await issue();
    for (let i = 0; i < 4; i++) expect(await verify(wrong(code))).toBe("invalid");
    expect(await verify(code)).toBe("ok");
  });

  it("biên hết hạn: ngay trước expires_at → ok; đúng expires_at → invalid", async () => {
    const a = await issue();
    await ageChallenge(5 * MIN - MARGIN);
    expect(await verify(a)).toBe("ok");
    await sqlAsMigrator(`DELETE FROM otp_send_log`);
    const b = await issue();
    await ageChallenge(5 * MIN);
    expect(await verify(b)).toBe("invalid");
  });

  it("2 lời gọi song song cùng mã đúng → đúng 1 ok", async () => {
    const code = await issue();
    const results = await Promise.all([verify(code), verify(code)]);
    expect(results.sort()).toEqual(["invalid", "ok"]);
  });

  it("sau rotateOtpPepper('v2') mã cũ → invalid, mã phát sau dùng key_version v2", async () => {
    const oldCode = await issue();
    await disconnectDb();
    vi.stubEnv("OTP_PEPPER_CURRENT", "v2");
    vi.resetModules();
    try {
      const otp = await import("@/modules/auth-learner/otp");
      const db = await import("@/lib/db");
      expect(await otp.rotateOtpPepper("v2")).toBe(1);
      expect(await db.withTx((tx) => otp.verifyOtp(tx, { purpose: "login", kind: "email", value: VALUE, code: oldCode }))).toBe("invalid");
      await sqlAsMigrator(`DELETE FROM otp_send_log`);
      const sink = new FakeEmailSink();
      await otp.issueOtp({ purpose: "login", kind: "email", value: VALUE, ip: "10.0.0.1", create: true }, sink);
      expect((await challenge()).keyVersion).toBe("v2");
      await expect(otp.rotateOtpPepper("v9")).rejects.toThrow();
      await db.disconnectDb();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
