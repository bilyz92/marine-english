import { describe, expect, it } from "vitest";
import { classify, extractOrderCodes } from "@/modules/ledger/classifier";

const C = "ME7K3QX9AB";
const D = "MEHJKMNP23";

describe("extractOrderCodes", () => {
  it.each([
    [`${C}`, [C]],
    [`ck ${C.toLowerCase()} cam on`, [C]],
    [`Chuyển tiền ${C}.`, [C]],
    [`Thanh toán đơn ${C} — Nguyễn Văn Đức`, [C]],
    [`${C} ${C}`, [C]],
    [`${C} ${D}`, [C, D]],
    [`MBVCB.123456.${C}.CT tu 0123`, [C]],
    [`${C}XY`, []],
    [`X${C}`, []],
    ["ME0K3QX9AB", []],
    ["ME7K3QX9A", []],
    ["", []],
  ])("%s → %j", (content, expected) => {
    expect(extractOrderCodes(content)).toEqual(expected);
  });
});

describe("classify", () => {
  const createdAt = new Date("2026-10-30T03:00:00Z");
  const expiresAt = new Date("2026-10-30T03:15:00Z");
  const now = new Date("2026-10-30T03:20:00Z");
  const order = { id: "o1", status: "pending" as const, amountDueVnd: 199_000, createdAt, expiresAt };
  const base = { amountVnd: 199_000, bankTime: new Date("2026-10-30T03:05:00Z"), now, codes: [C], order };
  const at = (iso: string) => new Date(iso);

  it.each([
    ["đúng tiền trong hạn, pending", {}, { result: "auto_confirm" }],
    ["đơn đã expired nhưng bankTime trong hạn", { order: { ...order, status: "expired" as const } }, { result: "auto_confirm" }],
    ["bankTime = createdAt", { bankTime: createdAt }, { result: "auto_confirm" }],
    ["bankTime = expiresAt", { bankTime: expiresAt }, { result: "queue", reason: "late" }],
    ["bankTime trước createdAt", { bankTime: at("2026-10-30T02:59:59Z") }, { result: "queue", reason: "early" }],
    ["tương lai quá 5 phút", { bankTime: at("2026-10-30T03:25:01Z") }, { result: "queue", reason: "bad_time" }],
    ["tương lai đúng 5 phút", { bankTime: at("2026-10-30T03:25:00Z"), now: at("2026-10-30T03:20:00Z"), order: { ...order, expiresAt: at("2026-10-30T04:00:00Z") } }, { result: "auto_confirm" }],
    ["thiếu 1 đồng", { amountVnd: 198_999 }, { result: "queue", reason: "amount_short" }],
    ["thừa tiền", { amountVnd: 200_000 }, { result: "queue", reason: "amount_over" }],
    ["không mã", { codes: [], order: null }, { result: "queue", reason: "no_code" }],
    ["nhiều mã", { codes: [C, D] }, { result: "queue", reason: "multi_code" }],
    ["mã không tồn tại", { order: null }, { result: "queue", reason: "unknown_code" }],
    ["đơn đã paid", { order: { ...order, status: "paid" as const } }, { result: "queue", reason: "order_paid" }],
    ["đơn đã hoàn", { order: { ...order, status: "refunded" as const } }, { result: "queue", reason: "order_refunded" }],
  ])("%s", (_name, patch, expected) => {
    expect(classify({ ...base, ...patch })).toEqual(expected);
  });
});
