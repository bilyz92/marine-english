import { describe, expect, it, vi } from "vitest";

// Tệp riêng để đặt cấu hình trước khi env() được đọc lần đầu.
vi.hoisted(() => {
  process.env.ZNS_DAILY_BUDGET = "3";
  process.env.ZALO_LOGIN_ENABLED = "true";
});

import { issueOtp } from "@/modules/auth-learner/otp";
import { FakeEmailSink } from "@/modules/mail/fake-sink";
import { sqlAsMigrator } from "../helpers/otp";

const phones = ["+84912345671", "+84912345672", "+84912345673", "+84912345674", "+84912345675"];
const input = (value: string) => ({ purpose: "login" as const, kind: "phone" as const, value, ip: "10.0.0.9", create: true });

describe("ngân sách ZNS mỗi ngày", () => {
  it("ngân sách 3, 5 số khác nhau song song → đúng 3 sent; sang ngày mới (giờ VN) gửi lại được", async () => {
    const sink = new FakeEmailSink();
    const results = await Promise.all(phones.map((p) => issueOtp(input(p), sink)));
    expect(results.filter((r) => r === "sent")).toHaveLength(3);
    expect(results.filter((r) => r === "throttled")).toHaveLength(2);
    const { rows } = await sqlAsMigrator(
      `SELECT day::text AS day, used FROM zns_daily_budget`,
    );
    const { rows: today } = await sqlAsMigrator(`SELECT ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text AS d`);
    expect(rows).toEqual([{ day: today[0].d, used: 3 }]);
    // Giả lập qua 00:00 giờ Việt Nam: dòng ngân sách hôm nay thành của hôm qua.
    await sqlAsMigrator(`UPDATE zns_daily_budget SET day = day - 1`);
    const unsent = phones.filter((_, i) => results[i] === "throttled");
    expect(await issueOtp(input(unsent[0]!), sink)).toBe("sent");
  });

  it("email không tốn ngân sách ZNS", async () => {
    await sqlAsMigrator(
      `INSERT INTO zns_daily_budget (day, used) VALUES ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 3)`,
    );
    const sink = new FakeEmailSink();
    expect(await issueOtp({ ...input("hv@x.vn"), kind: "email" }, sink)).toBe("sent");
    expect(await issueOtp(input(phones[0]!), sink)).toBe("throttled");
  });
});
