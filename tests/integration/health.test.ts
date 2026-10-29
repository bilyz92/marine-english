import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { createHealthHandler } from "@/lib/health";

describe("GET /api/health", () => {
  it("trả 200 và db up khi Postgres trả lời", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  it("trả 503 khi không kết nối được DB", async () => {
    const handler = createHealthHandler(async () => {
      throw new Error("connection refused");
    });
    const res = await handler(new Request("http://localhost/api/health"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
