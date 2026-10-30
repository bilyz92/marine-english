import { randomInt } from "node:crypto";

// Mã đơn ghi vào nội dung chuyển khoản: ME + 8 ký tự, bỏ ký tự dễ nhầm (0/O, 1/I/L). [G5]
export const ORDER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newOrderCode(): string {
  let code = "ME";
  for (let i = 0; i < 8; i++) code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  return code;
}
