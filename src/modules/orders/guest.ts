import { withTx, type Tx } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { emailInUse, generatedPassword, lockKeys, phoneTaken } from "@/modules/auth-learner/password";
import { hashPassword } from "@/modules/auth-learner/password-hash";
import { openGuestPassword, savePendingCredentials, sealGuestPassword } from "@/modules/auth-learner/pending-credentials";
import { canonicalizeEmail } from "@/modules/identity/email";
import { canonicalizeVnPhone } from "@/modules/identity/phone";
import { newOrderCode } from "./codes";
import { guestAccessTokenHash } from "./guest-access";
import { insertOrder, saleCourse, type OrderView } from "./orders";

export { guestAccessTokenHash };

// Đơn của khách chưa có tài khoản (chủ 16/11/2026, docs/superpowers/plans/2026-11-16-guest-orders.md): tạo đơn trước, tạo tài khoản
// trong cùng transaction nhận tiền. Mật khẩu tạm băm sẵn lúc tạo đơn (không băm trong transaction nhận tiền); bản niêm phong gắn với đơn,
// niêm phong lại theo học viên khi nhận tiền để thư "đã thanh toán" ghép vào lúc gửi. Trang đơn mở bằng mã truy cập trong cookie.

const GUEST_ORDERS_PER_IP_HOUR = 10;

export type GuestOrderInput = { courseSlug: string; displayName: string; phone: string; email: string; ip: string; termsVersion: string };
export type CreateGuestOrderResult =
  | { kind: "created"; order: OrderView; accessToken: string }
  | { kind: "invalid_phone" | "invalid_email" | "phone_taken" | "email_taken" | "pending_order" | "throttled" | "not_for_sale" };

/** Số hoặc email đang có đơn khách còn hạn. */
async function openGuestOrder(tx: Tx, phone: string, email: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ open: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM guest_orders g JOIN orders o ON o.id = g.order_id
                   WHERE (g.phone_canonical = ${phone} OR g.email = ${email}) AND o.status = 'pending' AND o.expires_at > now()) AS open`;
  return row!.open;
}

async function blocked(tx: Tx, phone: string, email: string): Promise<"phone_taken" | "email_taken" | "pending_order" | null> {
  if (await phoneTaken(tx, phone, null)) return "phone_taken";
  if (await emailInUse(tx, email)) return "email_taken";
  if (await openGuestOrder(tx, phone, email)) return "pending_order";
  return null;
}

/**
 * Ba bước như đăng ký bằng mật khẩu: (1) transaction ngắn dưới khóa IP → số → email: hạn mức IP, giữ một lượt, kiểm trùng;
 * (2) băm mật khẩu tạm ngoài transaction; (3) dưới cùng các khóa kiểm lại rồi tạo đơn + guest_orders + chấp nhận điều khoản.
 */
export async function createGuestOrder(input: GuestOrderInput, opts: { codeSource?: () => string } = {}): Promise<CreateGuestOrderResult> {
  const phone = canonicalizeVnPhone(input.phone);
  if (!phone) return { kind: "invalid_phone" };
  const email = canonicalizeEmail(input.email);
  if (!email) return { kind: "invalid_email" };
  const displayName = input.displayName.trim();

  const first = await withTx(async (tx) => {
    await lockKeys(tx, input.ip, phone, email);
    const course = await saleCourse(tx, input.courseSlug);
    if (!course) return { kind: "not_for_sale" as const };
    const [n] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_attempts WHERE ip = ${input.ip}::inet AND kind = 'guest_order' AND at > now() - interval '1 hour'`;
    if (n!.n >= GUEST_ORDERS_PER_IP_HOUR) return { kind: "throttled" as const };
    await tx.$executeRaw`INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('guest_order', ${input.ip}::inet, ${phone}, false)`;
    const why = await blocked(tx, phone, email);
    return why ? { kind: why } : null;
  });
  if (first) return first;

  const password = generatedPassword();
  const hash = await hashPassword(password);
  const accessToken = randomToken();

  return withTx(async (tx): Promise<CreateGuestOrderResult> => {
    await lockKeys(tx, input.ip, phone, email);
    const course = await saleCourse(tx, input.courseSlug);
    if (!course) return { kind: "not_for_sale" };
    const why = await blocked(tx, phone, email);
    if (why) return { kind: why };
    const order = await insertOrder(tx, { userId: null, course, codeSource: opts.codeSource ?? newOrderCode });
    await tx.$executeRaw`
      INSERT INTO guest_orders (order_id, display_name, phone_canonical, email, password_hash, password_enc, access_token_hash, created_ip)
      VALUES (${order.id}::uuid, ${displayName}, ${phone}, ${email}, ${hash}, ${sealGuestPassword(order.id, password)},
              ${guestAccessTokenHash(accessToken)}, ${input.ip}::inet)`;
    await tx.$executeRaw`
      INSERT INTO order_terms_acceptances (order_id, user_id, terms_version) VALUES (${order.id}::uuid, NULL, ${input.termsVersion})`;
    const [view] = await tx.$queryRaw<{ code: string; status: OrderView["status"]; amount_due_vnd: number; expires_at: Date; slug: string; title_vi: string }[]>`
      SELECT o.code, o.status, o.amount_due_vnd, o.expires_at, c.slug, c.title_vi
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id WHERE o.id = ${order.id}::uuid`;
    return {
      kind: "created", accessToken,
      order: { code: view!.code, status: view!.status, amountDueVnd: view!.amount_due_vnd, expiresAt: view!.expires_at, courseSlug: view!.slug, courseTitleVi: view!.title_vi },
    };
  });
}

type GuestRow = { display_name: string; phone_canonical: string; email: string; password_hash: string; password_enc: string | null; user_id: string | null };

async function guestRow(tx: Tx, orderId: string): Promise<GuestRow | null> {
  const [row] = await tx.$queryRaw<GuestRow[]>`
    SELECT display_name, phone_canonical, email, password_hash, password_enc, user_id FROM guest_orders WHERE order_id = ${orderId}::uuid`;
  return row ?? null;
}

/** Lý do không tạo được tài khoản cho đơn khách: số/email đã thuộc tài khoản khác, hoặc không mở được mật khẩu tạm (khóa đã gỡ, dữ liệu hỏng). */
export type GuestBlocker = "guest_conflict" | "guest_credentials";

export class GuestBlockedError extends Error {
  constructor(readonly reason: GuestBlocker) {
    super(reason);
  }
}

/**
 * Đơn khách chưa có tài khoản mà không tạo được tài khoản lúc này; đơn thường hoặc đã có tài khoản → null. Lấy khóa số rồi khóa email
 * (giữ tới hết transaction) trước khi kiểm, nên kết luận đứng vững tới lúc tạo tài khoản.
 */
export async function guestBlocker(tx: Tx, orderId: string): Promise<GuestBlocker | null> {
  const g = await guestRow(tx, orderId);
  if (!g || g.user_id) return null;
  await lockKeys(tx, null, g.phone_canonical, g.email);
  if ((await phoneTaken(tx, g.phone_canonical, null)) || (await emailInUse(tx, g.email))) return "guest_conflict";
  if (!g.password_enc || !openGuestPassword(orderId, g.password_enc)) return "guest_credentials";
  return null;
}

/**
 * Tạo tài khoản cho đơn khách lúc nhận tiền (trong transaction của settleOrder, sau `guestBlocker`): users, dòng mật khẩu đã băm sẵn
 * (bắt đổi lần đầu), mật khẩu tạm niêm phong theo học viên (thư "đã thanh toán" ghép vào lúc gửi), email liên hệ; rồi gắn đơn.
 * Đơn thường hoặc đã có tài khoản → trả người mua hiện có.
 */
export async function createAccountForGuestOrder(tx: Tx, orderId: string): Promise<string> {
  const [order] = await tx.$queryRaw<{ user_id: string | null }[]>`SELECT user_id FROM orders WHERE id = ${orderId}::uuid`;
  if (order!.user_id) return order!.user_id;
  const g = (await guestRow(tx, orderId))!;
  // Mật khẩu tạm là đường duy nhất để khách đăng nhập: không mở được thì không ghi gì (người gọi đã kiểm `guestBlocker`).
  const password = g.password_enc ? openGuestPassword(orderId, g.password_enc) : null;
  if (!password) throw new GuestBlockedError("guest_credentials");
  const [user] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO users (display_name, rank) VALUES (${g.display_name}, NULL) RETURNING id`;
  const userId = user!.id;
  await tx.$executeRaw`
    INSERT INTO password_logins (user_id, phone_canonical, password_hash, must_change) VALUES (${userId}::uuid, ${g.phone_canonical}, ${g.password_hash}, true)`;
  await savePendingCredentials(tx, userId, password);
  await tx.$executeRaw`INSERT INTO learner_contact_emails (user_id, email) VALUES (${userId}::uuid, ${g.email})`;
  await tx.$executeRaw`UPDATE guest_orders SET user_id = ${userId}::uuid, password_enc = NULL WHERE order_id = ${orderId}::uuid`;
  await tx.$executeRaw`UPDATE orders SET user_id = ${userId}::uuid WHERE id = ${orderId}::uuid`;
  return userId;
}
