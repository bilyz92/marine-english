import { expect, it } from "vitest";
import { newOrderCode, ORDER_CODE_ALPHABET } from "@/modules/orders/codes";

it("mã đơn: ME + 8 ký tự không có ký tự dễ nhầm, gần như không lặp", () => {
  expect(ORDER_CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  const codes = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    const code = newOrderCode();
    expect(code).toMatch(/^ME[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    codes.add(code);
  }
  expect(codes.size).toBe(10_000);
});
