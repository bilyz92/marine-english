import { prisma } from "@/lib/db";
import { hmacHex } from "@/lib/crypto";
import { env } from "@/lib/env";

// Mã truy cập trang đơn khách (cookie __Host-me_order_<mã đơn>): chỉ lưu băm, khóa riêng của máy chủ.

export function guestAccessTokenHash(token: string): string {
  return hmacHex(Buffer.from(env().SESSION_KEY_LEARNER, "base64"), `guest-order|${token}`);
}

/** Đơn khách theo mã + mã truy cập; sai → null, không lộ đơn có tồn tại. */
export async function guestOrderId(code: string, accessToken: string): Promise<string | null> {
  const [row] = await prisma().$queryRaw<{ id: string }[]>`
    SELECT o.id FROM orders o JOIN guest_orders g ON g.order_id = o.id
    WHERE o.code = ${code.trim().toUpperCase()} AND g.access_token_hash = ${guestAccessTokenHash(accessToken)}`;
  return row?.id ?? null;
}
