import { describe, expect, it } from "vitest";
import { canonicalizeVnPhone, toZnsFormat } from "@/modules/identity/phone";

describe("canonicalizeVnPhone", () => {
  it.each([
    ["0912345678", "+84912345678"],
    ["0912 345 678", "+84912345678"],
    ["84912345678", "+84912345678"],
    ["+84-912.345.678", "+84912345678"],
    ["(+84) 912 345 678", "+84912345678"],
    ["0312345678", "+84312345678"],
    ["+84 0912345678", null],
    ["0241234567", null],
    ["091234567", null],
    ["09123456789", null],
    ["+12025550123", null],
    ["abc", null],
    ["", null],
  ])("canonicalizeVnPhone(%s) = %s", (input, expected) => {
    expect(canonicalizeVnPhone(input)).toBe(expected);
  });
});

it("toZnsFormat chuyển +84 về dạng 0", () => {
  expect(toZnsFormat("+84912345678")).toBe("0912345678");
});
