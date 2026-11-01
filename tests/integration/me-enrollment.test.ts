import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/me/enrollment/route";
import { ingest } from "@/modules/ledger/ingest";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { paidCourseSetup, report, SLUG } from "../helpers/ledger";

// Trang khóa chỉ cần biết đã có khóa chưa (UC-03 A3): route nhẹ, không đọc đơn hay hàng chờ giao dịch.
const ask = async (path: string, l: Awaited<ReturnType<typeof testLearner>>) => {
  const res = await GET(learnerRequest(path, l));
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { enrolled: boolean }) : null, cache: res.headers.get("cache-control") };
};

describe("GET /api/me/enrollment", () => {
  it("đã mua → enrolled true; chưa mua hay khóa không tồn tại → false; không lưu cache", async () => {
    const s = await paidCourseSetup();
    expect(await ask(`/api/me/enrollment?course=${SLUG}`, s.learner)).toEqual({ status: 200, body: { enrolled: false }, cache: "private, no-store" });
    expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
    expect((await ask(`/api/me/enrollment?course=${SLUG}`, s.learner)).body).toEqual({ enrolled: true });
    expect((await ask(`/api/me/enrollment?course=${SLUG}`, await testLearner())).body).toEqual({ enrolled: false });
    expect((await ask("/api/me/enrollment?course=khong_co", s.learner)).body).toEqual({ enrolled: false });
  });

  it("thiếu khóa → 400; chưa đăng nhập → 401", async () => {
    const l = await testLearner();
    expect((await ask("/api/me/enrollment", l)).status).toBe(400);
    expect((await GET(new Request(`${process.env.APP_ORIGIN}/api/me/enrollment?course=${SLUG}`))).status).toBe(401);
  });
});
