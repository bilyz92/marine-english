import { prisma, withTx } from "@/lib/db";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { createSession } from "@/modules/sessions/sessions";
import { newDeviceKey } from "./learner";

export type TestLearner = LearnerCtx & { token: string; csrf: string };

export async function testLearner(name = "HV"): Promise<TestLearner> {
  const user = await prisma().user.create({ data: { displayName: name } });
  const device = await prisma().device.create({ data: { userId: user.id, deviceKeyHash: newDeviceKey(), label: "đt" } });
  const s = await withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt: new Date() }));
  return { userId: user.id, deviceId: device.id, sessionId: s.sessionId, authAt: new Date(), ip: "10.0.0.1", token: s.token, csrf: s.csrf };
}

export function learnerRequest(path: string, l: TestLearner, init: { method?: string; body?: unknown } = {}): Request {
  const method = init.method ?? "GET";
  return new Request(`${process.env.APP_ORIGIN}${path}`, {
    method,
    headers: {
      cookie: `__Host-me_learn=${l.token}`,
      origin: process.env.APP_ORIGIN!,
      "x-csrf-token": l.csrf,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
