import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as quickRoute } from "@/app/api/auth/learner/password/quick-register/route";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { readPendingCredentials, prunePendingCredentials } from "@/modules/auth-learner/pending-credentials";
import { deliverBatch, type Senders } from "@/modules/outbox/deliver";
import { newDeviceKey, ORIGIN } from "../helpers/learner";
import { sqlAsMigrator } from "../helpers/otp";

// Chủ 09/11/2026: thanh toán xong mới gửi thông tin đăng nhập vào email (docs/superpowers/plans/2026-11-09-checkout-credentials.md, Task 2).

let seq = 0;
const freshIp = () => `10.11.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;

async function guest(phone: string, email?: string): Promise<string> {
  await quickRoute(new Request(`${ORIGIN}/api/auth/learner/password/quick-register`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ displayName: "Khách", phone, deviceKey: newDeviceKey(), deviceLabel: "Máy", ...(email ? { email, emailConfirm: email } : {}) }),
  }));
  const { rows } = await sqlAsMigrator(`SELECT user_id FROM password_logins WHERE phone_canonical = $1`, [`+84${phone.slice(1)}`]);
  return rows[0].user_id as string;
}
const paidEmail = (userId: string) => prisma().outboxEvent.create({
  data: { dedupKey: `paid-${++seq}`, kind: "order_paid", channel: "email", payload: { orderId: "o1", orderCode: "ME7K3QX9AB", userId, amountVnd: 199000, courses: ["Thực tập sinh máy tàu dầu"], learnUrl: `${ORIGIN}/hoc` } },
});
function fakes(fail = false) {
  const mail: { to: string; subject: string; body: string }[] = [];
  const senders: Senders = {
    telegram: { send: async () => undefined },
    email: { send: async (to, subject, body) => { if (fail) throw new Error("mất mạng"); mail.push({ to, subject, body }); } },
  };
  return { senders, mail };
}
/** Thời điểm đã gửi email (null = chưa gửi); "none" = không còn bản chờ. */
const emailedAt = async (userId: string) => {
  const { rows } = await sqlAsMigrator(`SELECT emailed_at FROM learner_pending_credentials WHERE user_id = $1`, [userId]);
  return rows.length ? rows[0].emailed_at : "none";
};

describe("email thông tin đăng nhập khi thanh toán xong", () => {
  it("gửi tới email liên hệ, có số và mật khẩu tạm; đánh dấu đã gửi nhưng bước 3 vẫn đọc được; outbox không chứa mật khẩu", async () => {
    const userId = await guest("0916000101", "khach1@x.vn");
    const creds = await readPendingCredentials(userId);
    const event = await paidEmail(userId);
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.to).toBe("khach1@x.vn");
    expect(f.mail[0]!.body).toContain("0916000101");
    expect(f.mail[0]!.body).toContain(creds!.password);
    expect(f.mail[0]!.body).toContain("đặt mật khẩu mới");
    expect(await emailedAt(userId)).toBeInstanceOf(Date);
    expect(await readPendingCredentials(userId)).toEqual(creds);
    const stored = await prisma().outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(JSON.stringify(stored)).not.toContain(creds!.password);
  });

  it("gửi lỗi lần đầu: chưa đánh dấu; lần thử lại vẫn có mật khẩu", async () => {
    const userId = await guest("0916000202", "khach2@x.vn");
    const creds = await readPendingCredentials(userId);
    const event = await paidEmail(userId);
    await deliverBatch(fakes(true).senders);
    expect(await emailedAt(userId)).toBeNull();
    await prisma().outboxEvent.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail[0]!.body).toContain(creds!.password);
  });

  it("đã đổi mật khẩu trước khi tiền về: thư chỉ có số điện thoại, không có mật khẩu cũ", async () => {
    const userId = await guest("0916000303", "khach3@x.vn");
    const creds = await readPendingCredentials(userId);
    await loginRoute(new Request(`${ORIGIN}/api/auth/learner/password/login`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
      body: JSON.stringify({ phone: "0916000303", password: creds!.password, newPassword: "Thuyen vien moi 2026", deviceKey: newDeviceKey(), deviceLabel: "Máy" }),
    }));
    expect(await readPendingCredentials(userId)).toBeNull();
    await paidEmail(userId);
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail[0]!.body).toContain("0916000303");
    expect(f.mail[0]!.body).not.toContain(creds!.password);
  });

  it("không có email nào → không gửi thư; bản chờ quá 30 ngày bị dọn", async () => {
    const userId = await guest("0916000404");
    await paidEmail(userId);
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail).toHaveLength(0);
    await sqlAsMigrator(`UPDATE learner_pending_credentials SET created_at = now() - interval '31 days' WHERE user_id = $1`, [userId]);
    expect(await readPendingCredentials(userId)).toBeNull();
    expect(await prunePendingCredentials()).toBe(1);
  });

  it("thư đã thanh toán thứ hai (mua khóa khác) không gửi lại mật khẩu", async () => {
    const userId = await guest("0916000505", "khach5@x.vn");
    const creds = await readPendingCredentials(userId);
    await paidEmail(userId);
    await deliverBatch(fakes().senders);
    await paidEmail(userId);
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail[0]!.body).toContain("0916000505");
    expect(f.mail[0]!.body).not.toContain(creds!.password);
  });

  it("tài khoản đã gộp vào tài khoản khác: thư tới email liên hệ của tài khoản trong nhóm gộp", async () => {
    const source = await guest("0916000606", "khach6@x.vn");
    const { rows: [t] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('Đích') RETURNING id`);
    await sqlAsMigrator(`UPDATE users SET merged_into_id = $2, status = 'merged' WHERE id = $1`, [source, t.id]);
    // Đơn mới của tài khoản đích (đích không có email nào): dùng email liên hệ của tài khoản nguồn đã gộp vào.
    await paidEmail(t.id);
    const f = fakes();
    await deliverBatch(f.senders);
    expect(f.mail[0]?.to).toBe("khach6@x.vn");
  });
});
