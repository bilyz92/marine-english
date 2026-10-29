import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { json, route } from "@/lib/http";
import { devMailbox } from "@/modules/mail/fake-sink";
import { requireAdmin } from "@/modules/sessions/guards";
import { validateSession } from "@/modules/sessions/sessions";
import { POST as logout } from "@/app/api/auth/learner/logout/route";
import { cookieValue, lastCode, login, newDeviceKey, post, select, send, signup, verify } from "../helpers/learner";
import { ageSendLog } from "../helpers/otp";

beforeEach(() => devMailbox.clear());

const activeDevices = (userId: string) => prisma().device.count({ where: { userId, revokedAt: null } });

describe("đăng ký / đăng nhập bằng email", () => {
  it("đăng ký mới tạo user + định danh + thiết bị + phiên; đăng nhập lại không tạo user mới", async () => {
    const key = newDeviceKey();
    const { res, body } = await signup("HV@X.vn", key);
    expect(body).toEqual({ next: "done" });
    const token = cookieValue(res, "__Host-me_learn")!;
    const view = await validateSession("learner", token);
    expect(view).not.toBeNull();
    expect(cookieValue(res, "__Host-me_csrf_learner")).toBeTruthy();
    const user = await prisma().user.findUniqueOrThrow({ where: { id: view!.subjectId }, include: { identities: true } });
    expect(user).toMatchObject({ displayName: "Nguyễn Văn A", rank: "Thợ máy" });
    expect(user.identities).toMatchObject([{ kind: "email", valueCanonical: "hv@x.vn" }]);
    const again = await login("hv@x.vn", key);
    expect(again.body).toEqual({ next: "done" });
    expect(await prisma().user.count()).toBe(1);
    expect(await activeDevices(user.id)).toBe(1);
  });

  it("đăng ký với email đã có được xử lý như đăng nhập", async () => {
    await signup("hv@x.vn", newDeviceKey());
    const { body } = await login("hv@x.vn", newDeviceKey(), { displayName: "Tên khác", rank: null });
    expect(body).toEqual({ next: "done" });
    expect(await prisma().user.count()).toBe(1);
    expect((await prisma().user.findFirstOrThrow()).displayName).toBe("Nguyễn Văn A");
  });

  it("khóa thiết bị sai định dạng → 400 ở otp/verify và device/select", async () => {
    for (const deviceKey of ["ngan", `${newDeviceKey()}x`, `${newDeviceKey().slice(0, 42)}!`, undefined]) {
      expect((await verify({ contact: "hv@x.vn", code: "123456", deviceKey, deviceLabel: "x" })).status).toBe(400);
      expect((await select({ deviceKey, replaceDeviceId: crypto.randomUUID() }, "ve")).status).toBe(400);
    }
  });

  it("user disabled hoặc merged: mã đúng → invalid, không có phiên", async () => {
    for (const status of ["disabled", "merged"] as const) {
      const email = `${status}@x.vn`;
      await signup(email, newDeviceKey());
      const user = await prisma().user.findFirstOrThrow({ where: { identities: { some: { valueCanonical: email } } } });
      const target = await prisma().user.create({ data: { displayName: "Đích" } });
      await prisma().user.update({
        where: { id: user.id },
        data: { status, mergedIntoId: status === "merged" ? target.id : null },
      });
      const { res, body } = await login(email, newDeviceKey());
      expect(body).toEqual({ next: "invalid" });
      expect(cookieValue(res, "__Host-me_learn")).toBeUndefined();
    }
  });

  it("cùng một khóa thiết bị đăng nhập lần lượt hai tài khoản → mỗi tài khoản một dòng devices", async () => {
    const key = newDeviceKey();
    await signup("a@x.vn", key);
    await signup("b@x.vn", key);
    const rows = await prisma().device.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(2);
  });

  it("thiếu Origin đúng → 403", async () => {
    const req = new Request(`${process.env.APP_ORIGIN}/api/auth/learner/otp/send`, {
      method: "POST",
      headers: { origin: "https://evil.vn", "content-type": "application/json" },
      body: JSON.stringify({ contact: "hv@x.vn" }),
    });
    const { POST } = await import("@/app/api/auth/learner/otp/send/route");
    expect((await POST(req)).status).toBe(403);
  });
});

describe("chống dò tài khoản", () => {
  it("(có / không có) × (send / verify sai) → cùng mã trạng thái và body", async () => {
    await signup("co@x.vn", newDeviceKey());
    devMailbox.clear();
    await ageSendLog(61_000);

    const sendHas = await send({ contact: "co@x.vn" });
    const sendNone = await send({ contact: "khong@x.vn" });
    expect([sendHas.status, await sendHas.json()]).toEqual([200, { ok: true }]);
    expect([sendNone.status, await sendNone.json()]).toEqual([200, { ok: true }]);
    expect(devMailbox.messages().map((m) => m.to)).toEqual(["co@x.vn"]);

    const wrongCode = String((Number(lastCode("co@x.vn")) + 1) % 1_000_000).padStart(6, "0");
    const verifyHas = await verify({ contact: "co@x.vn", code: wrongCode, deviceKey: newDeviceKey(), deviceLabel: "x" });
    const verifyNone = await verify({ contact: "khong@x.vn", code: wrongCode, deviceKey: newDeviceKey(), deviceLabel: "x" });
    expect([verifyHas.status, await verifyHas.json()]).toEqual([200, { next: "invalid" }]);
    expect([verifyNone.status, await verifyNone.json()]).toEqual([200, { next: "invalid" }]);
  });

  it("signup có displayName với email chưa có → có thư", async () => {
    await send({ contact: "moi@x.vn", displayName: "Mới" });
    expect(devMailbox.messages().map((m) => m.to)).toEqual(["moi@x.vn"]);
  });
});

describe("đăng xuất và đổi tài khoản", () => {
  it("đăng xuất rồi đăng nhập lại 3 lần cùng khóa → vẫn 1 thiết bị; switchAccount thu hồi thiết bị", async () => {
    const key = newDeviceKey();
    let last = await signup("hv@x.vn", key);
    for (let i = 0; i < 3; i++) {
      const token = cookieValue(last.res, "__Host-me_learn")!;
      const csrf = cookieValue(last.res, "__Host-me_csrf_learner")!;
      const req = post("/api/auth/learner/logout", {}, `__Host-me_learn=${token}`);
      req.headers.set("x-csrf-token", csrf);
      expect((await logout(req)).status).toBe(200);
      last = await login("hv@x.vn", key);
      expect(last.body.next).toBe("done");
    }
    const user = await prisma().user.findFirstOrThrow();
    expect(await prisma().device.count({ where: { userId: user.id } })).toBe(1);

    const token = cookieValue(last.res, "__Host-me_learn")!;
    const req = post("/api/auth/learner/logout", { switchAccount: true }, `__Host-me_learn=${token}`);
    req.headers.set("x-csrf-token", cookieValue(last.res, "__Host-me_csrf_learner")!);
    expect((await logout(req)).status).toBe(200);
    expect(await activeDevices(user.id)).toBe(0);
    expect(await validateSession("learner", token)).toBeNull();
  });

  it("cookie vé gửi tới route quản trị → 401", async () => {
    const adminOnly = route(async (req) => json({ id: (await requireAdmin(req)).adminId }));
    await signup("hv@x.vn", newDeviceKey());
    await login("hv@x.vn", newDeviceKey());
    const { res } = await login("hv@x.vn", newDeviceKey());
    const ticket = cookieValue(res, "__Host-me_ticket")!;
    expect(ticket).toBeTruthy();
    const req = new Request(`${process.env.APP_ORIGIN}/api/quan-tri/x`, { headers: { cookie: `__Host-me_ticket=${ticket}; __Host-me_admin=${ticket}` } });
    expect((await adminOnly(req)).status).toBe(401);
  });

  it("vé đi qua route device/select: thay máy → done, cookie vé bị xóa", async () => {
    await signup("hv@x.vn", newDeviceKey());
    await login("hv@x.vn", newDeviceKey());
    const key = newDeviceKey();
    const { res, body } = await login("hv@x.vn", key);
    expect(body.next).toBe("choose_device");
    expect(cookieValue(res, "__Host-me_learn")).toBeUndefined();
    const ticketCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-me_ticket="))!;
    expect(ticketCookie).toContain("HttpOnly");
    expect(ticketCookie).toContain("Max-Age=600");
    const out = await select({ deviceKey: key, replaceDeviceId: body.devices![0]!.id }, cookieValue(res, "__Host-me_ticket"));
    expect(await out.json()).toEqual({ next: "done" });
    expect(cookieValue(out, "__Host-me_ticket")).toBe("");
    expect(await validateSession("learner", cookieValue(out, "__Host-me_learn")!)).not.toBeNull();
    const again = await select({ deviceKey: key, replaceDeviceId: body.devices![1]!.id }, cookieValue(res, "__Host-me_ticket"));
    expect(await again.json()).toEqual({ next: "invalid" });
  });
});
