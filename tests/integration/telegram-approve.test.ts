import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTest } from "@/lib/env";
import { prisma } from "@/lib/db";
import { POST as claimRoute } from "@/app/api/me/orders/[code]/claim/route";
import { POST as proofRoute } from "@/app/api/me/orders/[code]/proof/route";
import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { classifyPath } from "@/modules/sessions/routes";
import { insertAdmin } from "../helpers/admin";
import { paidCourseSetup } from "../helpers/ledger";
import { learnerRequest, type TestLearner } from "../helpers/learner-ctx";

// Chủ chọn 03/11/2026: duyệt hoặc khóa lại ngay trên Telegram (nút trong tin báo), bấm hai lần (chọn rồi xác nhận).

const SECRET = "s".repeat(40);
const CHAT = "-100777";
const OWNER_TG = 4242;
const OWNER_EMAIL = "chu-tele@x.vn";

const claim = (l: TestLearner, code: string) =>
  claimRoute(learnerRequest(`/api/me/orders/${code}/claim`, l, { method: "POST", body: {} }), { params: Promise.resolve({ code }) });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("anh-thu")]);
function sendProof(l: TestLearner, code: string) {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(PNG)]), "anh.png");
  form.set("message", "");
  return proofRoute(new Request(`${process.env.APP_ORIGIN}/api/me/orders/${code}/proof`, {
    method: "POST", body: form,
    headers: { cookie: `__Host-me_learn=${l.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": l.csrf },
  }), { params: Promise.resolve({ code }) });
}
const rejections = async (orderId: string) =>
  Number((await prisma().$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM transfer_claim_rejections WHERE order_id = ${orderId}::uuid`)[0]!.n);

let calls: { method: string; body: Record<string, unknown> }[] = [];
// Bàn phím đang hiện trên tin khi bấm (Telegram gửi kèm). Mặc định: đúng nút vừa bấm có trên tin.
function tap(data: string, opts: { from?: number; chat?: string; secret?: string | null; keyboard?: string[]; sentAt?: Date } = {}) {
  const update = {
    update_id: 1,
    callback_query: {
      id: "cb1", from: { id: opts.from ?? OWNER_TG }, data,
      message: {
        message_id: 9, date: Math.floor((opts.sentAt ?? new Date(Date.now() - 1000)).getTime() / 1000), chat: { id: Number(opts.chat ?? CHAT) }, text: "Khách báo đã chuyển khoản đơn X.",
        reply_markup: { inline_keyboard: [(opts.keyboard ?? [data]).map((d) => ({ text: "n", callback_data: d }))] },
      },
    },
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret !== null) headers["x-telegram-bot-api-secret-token"] = opts.secret ?? SECRET;
  return webhook(new Request(`${process.env.APP_ORIGIN}/api/telegram/webhook`, { method: "POST", headers, body: JSON.stringify(update) }));
}
const called = (method: string) => calls.filter((c) => c.method === method);
const order = (id: string) => prisma().order.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  vi.stubEnv("SEPAY_WEBHOOK_SECRETS", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "BIMAT");
  vi.stubEnv("TELEGRAM_BUSINESS_CHAT_ID", CHAT);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("TELEGRAM_APPROVERS", `${OWNER_TG}:${OWNER_EMAIL}`);
  resetEnvForTest();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  if (!(await prisma().adminUser.findFirst({ where: { emailLower: OWNER_EMAIL } }))) await insertAdmin(OWNER_EMAIL, "owner");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvForTest();
});

describe("webhook Telegram", () => {
  it("là đường của nhà cung cấp (không cần phiên đăng nhập)", () => {
    expect(classifyPath("/api/telegram/webhook")).toBe("provider");
  });

  it("chưa cấu hình mã bí mật → 503; sai mã → 401; không làm gì", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect((await tap(`A:${code}`, { secret: "sai".repeat(14) })).status).toBe(401);
    expect((await tap(`A:${code}`, { secret: null })).status).toBe(401);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    resetEnvForTest();
    expect((await tap(`A:${code}`)).status).toBe(503);
    expect((await order(orderId)).status).toBe("pending");
    expect(calls).toHaveLength(0);
  });

  it("bấm Đã thấy tiền → chỉ hỏi xác nhận, chưa đổi gì", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect((await tap(`a:${code}`)).status).toBe(200);
    expect((await order(orderId)).status).toBe("pending");
    const [edit] = called("editMessageReplyMarkup");
    expect(edit!.body).toMatchObject({ chat_id: CHAT, message_id: 9 });
    expect(JSON.stringify(edit!.body.reply_markup)).toContain(`A:${code}`);
    expect(JSON.stringify(edit!.body.reply_markup)).toContain(`x:${code}`);
    expect(called("answerCallbackQuery")).toHaveLength(1);
  });

  it("xác nhận duyệt → đơn đã thanh toán (xác minh owner_direct, ghi nhật ký), tin đổi thành Đã duyệt, bỏ nút", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect((await tap(`A:${code}`)).status).toBe(200);
    expect((await order(orderId)).status).toBe("paid");
    const v = await prisma().bankTransactionVerification.findFirstOrThrow({ where: { method: "owner_direct" }, orderBy: { createdAt: "desc" } });
    const owner = await prisma().adminUser.findFirstOrThrow({ where: { emailLower: OWNER_EMAIL } });
    expect(v.verifiedBy).toBe(owner.id);
    const audit = await prisma().adminAuditLog.findFirstOrThrow({ where: { action: "transfer_approve", targetId: orderId } });
    expect(audit.reason).toContain("Telegram");
    const [edit] = called("editMessageText");
    expect(edit!.body.text).toContain("Khách báo đã chuyển khoản đơn X.");
    expect(edit!.body.text).toContain("Đã duyệt");
    // Bỏ nút duyệt, giữ link mở đơn.
    expect(JSON.stringify(edit!.body.reply_markup)).not.toContain("callback_data");
    expect(JSON.stringify(edit!.body.reply_markup)).toContain(`/admin/don-hang?q=${code}`);
    // Bấm lại (tin cũ còn nút trên máy khác) → không duyệt hai lần.
    calls = [];
    await tap(`A:${code}`);
    expect(await prisma().paymentAllocation.count({ where: { orderId } })).toBe(1);
    expect(called("editMessageText")[0]!.body.text).toContain("đã thanh toán trước đó");
  });

  it("xác nhận không thấy tiền → khóa lại khóa học với lý do mặc định, tin đổi thành Đã khóa lại", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    const courseId = (await prisma().orderItem.findFirstOrThrow({ where: { orderId } })).courseId;
    await tap(`r:${code}`);
    expect(await hasCourseAccess(learner.userId, courseId)).toBe(true);
    await tap(`R:${code}`);
    expect(await hasCourseAccess(learner.userId, courseId)).toBe(false);
    const [rej] = await prisma().$queryRaw<{ reason: string }[]>`SELECT reason FROM transfer_claim_rejections WHERE order_id = ${orderId}::uuid`;
    expect(rej!.reason).toBe("Sao kê chưa thấy khoản chuyển cho đơn này.");
    expect(called("editMessageText")[0]!.body.text).toContain("Đã khóa lại");
  });

  it("nút Chắc chắn khóa lại còn trên tin cũ (sửa tin lỗi), khách gửi ảnh mới → bấm tin cũ không khóa thêm", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    const sentAt = new Date(Date.now() - 60_000);
    await tap(`R:${code}`, { sentAt });
    expect(await rejections(orderId)).toBe(1);
    expect((await sendProof(learner, code)).status).toBe(200);
    calls = [];
    await tap(`R:${code}`, { sentAt });
    expect(await rejections(orderId)).toBe(1);
    expect(called("answerCallbackQuery")[0]!.body.text).toBe("Tin đã cũ, xem tin mới hơn.");
    // Tin báo ảnh mới (gửi sau lần khóa) vẫn khóa lại được.
    await tap(`R:${code}`, { sentAt: new Date(Date.now() + 1000) });
    expect(await rejections(orderId)).toBe(2);
  });

  it("bấm Thôi → trả lại hai nút ban đầu", async () => {
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    await tap(`x:${code}`);
    const markup = JSON.stringify(called("editMessageReplyMarkup")[0]!.body.reply_markup);
    expect(markup).toContain(`a:${code}`);
    expect(markup).toContain(`r:${code}`);
    expect(markup).toContain(`/admin/don-hang?q=${code}`);
    // Bước hỏi lại cũng giữ link.
    calls = [];
    await tap(`a:${code}`);
    expect(JSON.stringify(called("editMessageReplyMarkup")[0]!.body.reply_markup)).toContain(`/admin/don-hang?q=${code}`);
  });

  it("bấm thẳng Chắc chắn khi tin chưa hiện nút đó (bỏ qua bước hỏi lại) → không làm gì", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    await tap(`A:${code}`, { keyboard: [`a:${code}`, `r:${code}`] });
    await tap(`R:${code}`, { keyboard: [`a:${code}`, `r:${code}`] });
    expect((await order(orderId)).status).toBe("pending");
    expect(await prisma().enrollment.count({ where: { claimOrderId: orderId, revokedAt: null } })).toBe(1);
    expect(called("answerCallbackQuery").map((c) => c.body.text)).toEqual(["Nút đã cũ, mở lại tin.", "Nút đã cũ, mở lại tin."]);
  });

  it("người bấm không phải chủ, hoặc bấm ở nhóm khác → không đổi gì, báo không có quyền", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect((await tap(`A:${code}`, { from: 999 })).status).toBe(200);
    expect((await tap(`A:${code}`, { chat: "-100555" })).status).toBe(200);
    expect((await order(orderId)).status).toBe("pending");
    expect(called("editMessageText")).toHaveLength(0);
    expect(called("answerCallbackQuery").map((c) => c.body.text)).toEqual(["Không có quyền.", "Không có quyền."]);
  });

  it("email trong danh sách duyệt không còn là chủ đang hoạt động → không duyệt", async () => {
    vi.stubEnv("TELEGRAM_APPROVERS", `${OWNER_TG}:ho-tro-tele@x.vn`);
    resetEnvForTest();
    if (!(await prisma().adminUser.findFirst({ where: { emailLower: "ho-tro-tele@x.vn" } }))) await insertAdmin("ho-tro-tele@x.vn", "support");
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    await tap(`A:${code}`);
    expect((await order(orderId)).status).toBe("pending");
    expect(called("answerCallbackQuery")[0]!.body.text).toBe("Không có quyền.");
  });
});
