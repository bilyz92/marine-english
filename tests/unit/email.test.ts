import { describe, expect, it } from "vitest";
import { canonicalizeEmail } from "@/modules/identity/email";

describe("canonicalizeEmail", () => {
  it.each([
    [" A@B.VN ", "a@b.vn"],
    ["a.b@gmail.com", "a.b@gmail.com"],
    ["no-at", null],
    ["a@", null],
    ["@b.vn", null],
    ["a b@c.vn", null],
  ])("canonicalizeEmail(%s) = %s", (input, expected) => {
    expect(canonicalizeEmail(input)).toBe(expected);
  });
});
