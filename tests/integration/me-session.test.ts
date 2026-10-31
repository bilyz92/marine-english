import { expect, it } from "vitest";
import { GET } from "@/app/api/me/session/route";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";

it("GET /api/me/session trả học viên và thiết bị theo phiên; không phiên → 401", async () => {
  const l = await testLearner("Nguyễn A");
  const res = await GET(learnerRequest("/api/me/session", l));
  expect(await res.json()).toEqual({ userId: l.userId, deviceId: l.deviceId, displayName: "Nguyễn A" });
  expect((await GET(new Request(`${process.env.APP_ORIGIN}/api/me/session`))).status).toBe(401);
});
