import { describe, expect, it, vi } from "vitest";

// connection() chỉ chạy được trong một yêu cầu của Next; ngoài đó (vitest) coi như đã có yêu cầu.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import robots from "@/app/robots";

describe("robots.txt", () => {
  it("chỉ tới sitemap theo APP_ORIGIN và vẫn chặn các khu riêng tư", async () => {
    const r = await robots();
    expect(r.sitemap).toBe(`${process.env.APP_ORIGIN!.replace(/\/$/, "")}/sitemap.xml`);
    expect(r.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/admin", "/hoc", "/tai-khoan", "/thanh-toan", "/mua", "/api"] });
  });
});
