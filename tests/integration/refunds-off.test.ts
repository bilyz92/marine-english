import { describe, expect, it } from "vitest";
import { GET as myRefunds, POST as requestMyRefund } from "@/app/api/me/refunds/route";
import { GET as me } from "@/app/api/quan-tri/me/route";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { TEST_PAYOUT } from "../helpers/ledger";

// Chủ dự án yêu cầu ẩn hoàn tiền (02/11/2026): học viên không tự gửi yêu cầu được; giao diện biết để ẩn.
describe("hoàn tiền đang tắt", () => {
  it("học viên gửi yêu cầu hoàn tiền → 404 refunds_off; danh sách đơn báo requestsOpen=false", async () => {
    const l = await testLearner();
    const res = await requestMyRefund(learnerRequest("/api/me/refunds", l, { method: "POST", body: { orderCode: "ME23456789", reason: "x", payout: TEST_PAYOUT } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "refunds_off" });
    expect(await (await myRefunds(learnerRequest("/api/me/refunds", l))).json()).toMatchObject({ requestsOpen: false });
  });

  it("trang quản trị nhận cờ tắt hoàn tiền", async () => {
    const s = await adminSess("owner");
    expect(await (await callAdmin(me, s, "GET", "/api/quan-tri/me")).json()).toMatchObject({ features: { refunds: false } });
  });
});
