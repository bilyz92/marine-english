import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { claimBatch, deliverBatch, markSent, type Senders } from "@/modules/outbox/deliver";
import { EmailNotConfiguredError } from "@/modules/mail/email-sender";
import { NotConfiguredError } from "@/modules/outbox/telegram";
import { sqlAsMigrator } from "../helpers/otp";

const PAID = { orderId: "o1", orderCode: "ME7K3QX9AB", userId: "", amountVnd: 199000 };
let seq = 0;

async function event(input: { kind?: string; channel?: string; payload?: object; status?: string; attempts?: number; claimedUntil?: Date; claimToken?: string } = {}) {
  return prisma().outboxEvent.create({
    data: {
      dedupKey: `t${++seq}`, kind: input.kind ?? "order_paid", channel: input.channel ?? "telegram", payload: input.payload ?? PAID,
      status: input.status ?? "pending", attempts: input.attempts ?? 0, claimedUntil: input.claimedUntil, claimToken: input.claimToken,
    },
  });
}
const get = (id: string) => prisma().outboxEvent.findUniqueOrThrow({ where: { id } });

function fakes(overrides: Partial<Senders> = {}) {
  const telegram: { chat: string; text: string }[] = [];
  const email: { to: string; subject: string }[] = [];
  const senders: Senders = {
    telegram: { send: async (chat, text) => void telegram.push({ chat, text }) },
    email: { send: async (to, subject) => void email.push({ to, subject }) },
    ...overrides,
  };
  return { senders, telegram, email };
}
const failing = (message = "mất mạng"): Senders["telegram"] => ({ send: async () => { throw new Error(message); } });

async function learner(email?: string) {
  const { rows: [u] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('HV') RETURNING id`);
  if (email) await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', $2, now())`, [u.id, email]);
  return u.id as string;
}

beforeEach(() => sqlAsMigrator(`DELETE FROM outbox_events`));

describe("deliverBatch", () => {
  it("gửi được → sent, có sent_at, xóa claim", async () => {
    const e = await event();
    const f = fakes();
    expect(await deliverBatch(f.senders)).toMatchObject({ sent: 1, retried: 0, dead: 0 });
    expect(f.telegram).toHaveLength(1);
    expect(f.telegram[0]!.chat).toBe("business");
    const row = await get(e.id);
    expect(row).toMatchObject({ status: "sent", attempts: 1, claimToken: null });
    expect(row.sentAt).not.toBeNull();
    expect(await deliverBatch(f.senders)).toMatchObject({ sent: 0 });
    expect(f.telegram).toHaveLength(1);
  });

  it("sender lỗi → pending, lùi giờ gửi theo giãn cách, lưu last_error", async () => {
    const e = await event({ attempts: 2 });
    expect(await deliverBatch(fakes({ telegram: failing() }).senders)).toMatchObject({ retried: 1 });
    const row = await get(e.id);
    expect(row).toMatchObject({ status: "pending", attempts: 3, lastError: "mất mạng", claimToken: null });
    const delayMs = row.nextAttemptAt.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(200_000); // 2^3 × 30 giây = 240 giây
    expect(delayMs).toBeLessThanOrEqual(240_000);
  });

  it("giãn cách không quá 1 giờ", async () => {
    const e = await event({ attempts: 6 });
    await deliverBatch(fakes({ telegram: failing() }).senders);
    expect((await get(e.id)).nextAttemptAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
  });

  it("lỗi lần thứ 8 → dead + đúng một cảnh báo nhóm lỗi", async () => {
    const e = await event({ attempts: 7 });
    expect(await deliverBatch(fakes({ telegram: failing() }).senders)).toMatchObject({ dead: 1 });
    expect((await get(e.id)).status).toBe("dead");
    const alerts = await prisma().outboxEvent.findMany({ where: { kind: "outbox_dead" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ channel: "telegram", status: "pending", payload: { eventId: e.id, eventKind: "order_paid", channel: "telegram" } });
  });

  it("tin của chính nhóm lỗi chết → không sinh thêm cảnh báo (không lặp vô hạn)", async () => {
    await event({ kind: "outbox_dead", payload: { eventKind: "order_paid", channel: "email", error: "x" }, attempts: 7 });
    await event({ kind: "job_failed", payload: { job: "me.x", status: "failed", error: "x" }, attempts: 7 });
    expect(await deliverBatch(fakes({ telegram: failing() }).senders)).toMatchObject({ dead: 2 });
    expect(await prisma().outboxEvent.count({ where: { status: "pending" } })).toBe(0);
    expect(await prisma().outboxEvent.count()).toBe(2);
  });

  it("tin sending có claim đã hết hạn → được lấy lại; claim còn hạn → không đụng", async () => {
    const stale = await event({ status: "sending", attempts: 1, claimedUntil: new Date(Date.now() - 1000), claimToken: crypto.randomUUID() });
    const live = await event({ status: "sending", attempts: 1, claimedUntil: new Date(Date.now() + 60_000), claimToken: crypto.randomUUID() });
    expect(await deliverBatch(fakes().senders)).toMatchObject({ sent: 1 });
    expect((await get(stale.id)).status).toBe("sent");
    expect((await get(live.id)).status).toBe("sending");
  });

  it("hai lô chạy song song → mỗi tin gửi đúng một lần", async () => {
    const ids = await Promise.all(Array.from({ length: 15 }, () => event()));
    const sent: string[] = [];
    const senders = fakes({ telegram: { send: async (_c, text) => void sent.push(text) } }).senders;
    const [a, b] = await Promise.all([deliverBatch(senders), deliverBatch(senders)]);
    expect(a.sent + b.sent).toBe(15);
    expect(sent).toHaveLength(15);
    expect(await prisma().outboxEvent.count({ where: { id: { in: ids.map((e) => e.id) }, status: "sent" } })).toBe(15);
  });

  it("ghi sent bằng claim cũ → 0 dòng, không đè lần gửi mới", async () => {
    const e = await event();
    const [first] = await claimBatch();
    await sqlAsMigrator(`UPDATE outbox_events SET claimed_until = now() - interval '1 second' WHERE id = $1`, [e.id]);
    const [second] = await claimBatch();
    expect(second!.claimToken).not.toBe(first!.claimToken);
    expect(await markSent(first!)).toBe(0);
    expect((await get(e.id)).status).toBe("sending");
    expect(await markSent(second!)).toBe(1);
  });

  it("Telegram chưa cấu hình → giữ pending not_configured, không tiến tới dead", async () => {
    const e = await event({ attempts: 7 });
    const notConfigured = { send: async () => { throw new NotConfiguredError(); } };
    expect(await deliverBatch(fakes({ telegram: notConfigured }).senders)).toMatchObject({ skipped: 1, dead: 0 });
    const row = await get(e.id);
    expect(row).toMatchObject({ status: "pending", attempts: 7, lastError: "not_configured" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("email chưa có nhà cung cấp (G7) → cũng chờ, không dead", async () => {
    const userId = await learner("a@x.vn");
    const e = await event({ channel: "email", payload: { ...PAID, userId }, attempts: 7 });
    const notConfigured = { send: async () => { throw new EmailNotConfiguredError(); } };
    expect(await deliverBatch(fakes({ email: notConfigured }).senders)).toMatchObject({ skipped: 1, dead: 0 });
    expect(await get(e.id)).toMatchObject({ status: "pending", lastError: "not_configured" });
  });

  it("email: gửi tới địa chỉ của học viên; tài khoản đã gộp thì tra theo tài khoản đích", async () => {
    const target = await learner("dich@x.vn");
    const source = await learner();
    await sqlAsMigrator(`UPDATE users SET merged_into_id = $1, status = 'merged' WHERE id = $2`, [target, source]);
    await event({ channel: "email", payload: { ...PAID, userId: source } });
    const f = fakes();
    expect(await deliverBatch(f.senders)).toMatchObject({ sent: 1 });
    expect(f.email[0]).toMatchObject({ to: "dich@x.vn" });
  });

  it("học viên không có email → đánh dấu sent kèm no_email, không gửi", async () => {
    const userId = await learner();
    const e = await event({ channel: "email", payload: { ...PAID, userId } });
    const f = fakes();
    expect(await deliverBatch(f.senders)).toMatchObject({ sent: 0, skipped: 1 });
    expect(f.email).toHaveLength(0);
    expect(await get(e.id)).toMatchObject({ status: "sent", lastError: "no_email" });
  });

  it("gửi quá ngân sách thời gian của claim → trả phần còn lại về hàng đợi, không tính lần thử", async () => {
    const e = await event({ attempts: 3 });
    const f = fakes();
    expect(await deliverBatch(f.senders, { claimBudgetMs: 0 })).toMatchObject({ sent: 0, skipped: 1 });
    expect(f.telegram).toHaveLength(0);
    expect(await get(e.id)).toMatchObject({ status: "pending", attempts: 3, claimToken: null });
  });

  it("sender lỗi không đụng tới đơn hay quyền học: chỉ cập nhật outbox", async () => {
    const e = await event();
    await deliverBatch(fakes({ telegram: failing() }).senders);
    expect((await get(e.id)).status).toBe("pending");
    expect(await prisma().enrollment.count()).toBe(0);
  });
});
