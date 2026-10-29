import { describe, expect, it } from "vitest";
import { hmacHex, randomToken, safeEqualHex } from "@/lib/crypto";

describe("crypto", () => {
  it("randomToken dài 43 ký tự base64url và không lặp", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("hmacHex ổn định theo khóa và dữ liệu", () => {
    const key = Buffer.alloc(32, 1);
    expect(hmacHex(key, "x")).toBe(hmacHex(key, "x"));
    expect(hmacHex(key, "x")).not.toBe(hmacHex(Buffer.alloc(32, 2), "x"));
    expect(hmacHex(key, "x")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("safeEqualHex", () => {
    expect(safeEqualHex("ab", "ab")).toBe(true);
    expect(safeEqualHex("ab", "ac")).toBe(false);
    expect(safeEqualHex("ab", "abc")).toBe(false);
  });
});
