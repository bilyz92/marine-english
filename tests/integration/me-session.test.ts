import { expect, it } from "vitest";
import { GET } from "@/app/api/me/session/route";
import { prisma } from "@/lib/db";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";

const label = async (l: Awaited<ReturnType<typeof testLearner>>) =>
  ((await (await GET(learnerRequest("/api/me/session", l))).json()) as { accountLabel: string }).accountLabel;

it("GET /api/me/session trả học viên và thiết bị theo phiên; không phiên → 401", async () => {
  const l = await testLearner("Nguyễn A");
  const res = await GET(learnerRequest("/api/me/session", l));
  expect(await res.json()).toEqual({ userId: l.userId, deviceId: l.deviceId, displayName: "Nguyễn A", accountLabel: "Nguyễn A" });
  expect((await GET(new Request(`${process.env.APP_ORIGIN}/api/me/session`))).status).toBe(401);
});

it("accountLabel cho nút Tài khoản: email đã xác minh, rồi email liên hệ, rồi số điện thoại, rồi tên", async () => {
  const l = await testLearner("Trần B");
  await prisma().passwordLogin.create({ data: { userId: l.userId, phoneCanonical: "+84912000111", passwordHash: "scrypt$test" } });
  expect(await label(l)).toBe("0912000111");
  await prisma().learnerContactEmail.create({ data: { userId: l.userId, email: "lienhe@example.com" } });
  expect(await label(l)).toBe("lienhe@example.com");
  await prisma().userIdentity.create({ data: { userId: l.userId, kind: "google", valueCanonical: "sub-123", verifiedAt: new Date() } });
  await prisma().userIdentity.create({ data: { userId: l.userId, kind: "email", valueCanonical: "thuyen.vien@example.com", verifiedAt: new Date() } });
  expect(await label(l)).toBe("thuyen.vien@example.com");
});

it("accountLabel bỏ qua số điện thoại đã nhả", async () => {
  const l = await testLearner("Lê C");
  await prisma().passwordLogin.create({ data: { userId: l.userId, phoneCanonical: "+84912000222", passwordHash: "scrypt$test", releasedAt: new Date() } });
  expect(await label(l)).toBe("Lê C");
});
