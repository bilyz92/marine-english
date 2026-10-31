import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/client/safe-next";

const ORIGIN = "https://site.vn";

describe("safeNext", () => {
  it("giữ đường dẫn trong site kèm query", () => {
    expect(safeNext("/mua/khoa-a", ORIGIN)).toBe("/mua/khoa-a");
    expect(safeNext("/thanh-toan/ME7K3QX9AB?x=1", ORIGIN)).toBe("/thanh-toan/ME7K3QX9AB?x=1");
  });

  it.each(["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "https://evil.com/", "javascript:alert(1)", "evil.com", "", null, undefined])(
    "%j → /hoc",
    (value) => {
      expect(safeNext(value as string | null | undefined, ORIGIN)).toBe("/hoc");
    },
  );
});
