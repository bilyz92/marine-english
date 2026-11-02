import { describe, expect, it } from "vitest";
import { GET as history } from "@/app/api/me/payments/route";
import { ingest } from "@/modules/ledger/ingest";
import { createOrder } from "@/modules/orders/orders";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { paidCourseSetup, report } from "../helpers/ledger";
import { publish } from "../helpers/content";

// Menu điện thoại → "Lịch sử thanh toán": mọi đơn của chính học viên, mới nhất trước.
type Item = { code: string; course: string; slug: string; amountVnd: number; status: string; createdAt: string; paidAt: string | null; payableForSeconds: number };

describe("lịch sử thanh toán của học viên", () => {
  it("liệt kê đơn đã thanh toán và đơn chờ/hết hạn của chính mình, mới nhất trước; không thấy đơn người khác", async () => {
    const s = await paidCourseSetup();
    expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
    const other = await testLearner("Người khác");
    const otherOrder = await createOrder(other, "engine_cadet_tanker");
    if (otherOrder.kind !== "created") throw new Error(otherOrder.kind);
    expect((await createOrder(s.learner, "engine_cadet_tanker")).kind).toBe("already_enrolled");
    await publish("engine_cadet_dry_cargo");
    const later = await createOrder(s.learner, "engine_cadet_dry_cargo");
    if (later.kind !== "created") throw new Error(later.kind);

    const res = await history(learnerRequest("/api/me/payments", s.learner));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { payments } = (await res.json()) as { payments: Item[] };
    expect(payments.map((p) => [p.code, p.status, p.slug])).toEqual([[later.order.code, "pending", "engine_cadet_dry_cargo"], [s.code, "paid", "engine_cadet_tanker"]]);
    expect(payments[1]!.paidAt).not.toBeNull();
    // Thời hạn chuyển khoản do máy chủ tính (giờ trên tàu có thể sai): đơn chờ còn hạn có số giây còn lại, đơn đã trả thì không.
    expect(payments[0]!.payableForSeconds).toBeGreaterThan(14 * 60);
    expect(payments[0]!.payableForSeconds).toBeLessThanOrEqual(15 * 60);
    expect(payments[1]!.payableForSeconds).toBe(0);
    expect(payments[0]!.amountVnd).toBeGreaterThan(0);

    const theirs = (await (await history(learnerRequest("/api/me/payments", other))).json()) as { payments: Item[] };
    expect(theirs.payments.map((p) => [p.code, p.status])).toEqual([[otherOrder.order.code, "pending"]]);
  });

  it("chưa đăng nhập → 401", async () => {
    const res = await history(new Request(`${process.env.APP_ORIGIN}/api/me/payments`));
    expect(res.status).toBe(401);
  });
});
