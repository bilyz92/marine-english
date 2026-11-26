import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// DB trục trặc khi tra đường dẫn công khai: proxy không được trả 500 cho mọi trang khóa, mà để trang tự dựng như trước.
vi.mock("@/modules/content/public-urls", () => ({ routePublicPath: vi.fn(async () => { throw new Error("pool exhausted"); }) }));

describe("proxy: tra đường dẫn khóa lỗi", () => {
  it("cho request đi tiếp (không 500, không chuyển hướng)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("https://conghung.ce-tanker.vn/khoa-hoc/luyen-phong-van-engine-cadet"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
