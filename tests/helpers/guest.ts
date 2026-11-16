import { withTx } from "@/lib/db";
import { createAccountForGuestOrder, createGuestOrder } from "@/modules/orders/guest";
import { publish, seedContent } from "./content";
import { sqlAsMigrator } from "./otp";

let ipSeq = 0;

/**
 * Học viên tạo từ đơn khách (chủ 16/11/2026): có số + mật khẩu tạm (bắt đổi), bản chờ niêm phong, email liên hệ. Đi đúng đường của
 * máy chủ (createGuestOrder rồi createAccountForGuestOrder) nhưng không qua sổ tiền. Trả user id.
 */
export async function issuedLearner(phone: string, email = `k${phone}@x.vn`): Promise<string> {
  const { rows } = await sqlAsMigrator(`SELECT 1 FROM courses WHERE slug = 'engine_cadet_tanker' AND status = 'published'`);
  if (!rows.length) {
    await seedContent();
    await publish("engine_cadet_tanker");
  }
  ++ipSeq;
  const r = await createGuestOrder({
    courseSlug: "engine_cadet_tanker", displayName: "Khách", phone, email, ip: `10.13.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`, termsVersion: "v1",
  });
  if (r.kind !== "created") throw new Error(r.kind);
  const { rows: [o] } = await sqlAsMigrator(`SELECT id FROM orders WHERE code = $1`, [r.order.code]);
  return withTx((tx) => createAccountForGuestOrder(tx, o.id));
}
