import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { completeLearnerAuth, consumeTicketAndReplace, hashDeviceKey } from "@/modules/auth-learner/devices";
import { validateSession } from "@/modules/sessions/sessions";
import { newDeviceKey } from "../helpers/learner";
import { sqlAsMigrator } from "../helpers/otp";

const MIN = 60_000;
const MARGIN = 1_000;

async function newUser() {
  return (await prisma().user.create({ data: { displayName: "HV" } })).id;
}

function auth(userId: string, deviceKey: string) {
  return withTx((tx) => completeLearnerAuth(tx, { userId, deviceKeyHash: hashDeviceKey(deviceKey), deviceLabel: "Máy", authAt: new Date() }));
}

async function session(userId: string, deviceKey: string) {
  const r = await auth(userId, deviceKey);
  if (r.kind !== "session") throw new Error(`mong đợi session, nhận ${r.kind}`);
  return r;
}

async function ticket(userId: string, deviceKey: string) {
  const r = await auth(userId, deviceKey);
  if (r.kind !== "choose_device") throw new Error(`mong đợi choose_device, nhận ${r.kind}`);
  return r;
}

const active = (userId: string) => prisma().device.count({ where: { userId, revokedAt: null } });

async function twoDevices(userId: string) {
  const a = newDeviceKey();
  const b = newDeviceKey();
  return { a, b, sa: await session(userId, a), sb: await session(userId, b) };
}

describe("hashDeviceKey", () => {
  it("chỉ nhận 43 ký tự base64url; lưu HMAC", () => {
    const key = newDeviceKey();
    expect(hashDeviceKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceKey(key)).not.toContain(key);
    for (const bad of ["", "ngan", `${key}x`, `${key.slice(0, 42)}+`]) expect(() => hashDeviceKey(bad)).toThrow();
  });
});

describe("giới hạn 2 thiết bị", () => {
  it("máy thứ ba → choose_device chưa có phiên; chọn thay → máy cũ thu hồi, phiên cũ null, phiên mới hợp lệ", async () => {
    const userId = await newUser();
    const { sa } = await twoDevices(userId);
    const c = newDeviceKey();
    const t = await ticket(userId, c);
    expect(t.devices).toHaveLength(2);
    expect(await prisma().learnerSession.count()).toBe(2);
    const old = (await validateSession("learner", sa.token))!;
    const out = await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: c, replaceDeviceId: old.deviceId! });
    expect(out).not.toBeNull();
    expect((await prisma().device.findUniqueOrThrow({ where: { id: old.deviceId! } })).revokedAt).not.toBeNull();
    expect(await validateSession("learner", sa.token)).toBeNull();
    expect(await validateSession("learner", out!.token)).not.toBeNull();
    expect(await active(userId)).toBe(2);
  });

  it("thiết bị bị thu hồi từ xa đăng nhập lại khi còn chỗ → kích hoạt lại dòng cũ", async () => {
    const userId = await newUser();
    const key = newDeviceKey();
    const first = await session(userId, key);
    const deviceId = (await validateSession("learner", first.token))!.deviceId!;
    await prisma().device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    const again = await session(userId, key);
    expect((await validateSession("learner", again.token))!.deviceId).toBe(deviceId);
    expect(await prisma().device.count({ where: { userId } })).toBe(1);
  });

  it("thiết bị bị thu hồi từ xa, đủ 2 máy khác → vé → thay một máy → dòng cũ kích hoạt lại, không chèn trùng", async () => {
    const userId = await newUser();
    const key = newDeviceKey();
    const first = await session(userId, key);
    const deviceId = (await validateSession("learner", first.token))!.deviceId!;
    await prisma().device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    await twoDevices(userId);
    const t = await ticket(userId, key);
    const out = await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: t.devices[0]!.id });
    expect((await validateSession("learner", out!.token))!.deviceId).toBe(deviceId);
    expect(await prisma().device.count({ where: { userId } })).toBe(3);
    expect(await active(userId)).toBe(2);
  });
});

describe("vé thay máy", () => {
  async function setup() {
    const userId = await newUser();
    const devices = await twoDevices(userId);
    const key = newDeviceKey();
    const t = await ticket(userId, key);
    return { userId, key, t, ...devices };
  }

  it("dùng lại → null", async () => {
    const { key, t } = await setup();
    expect(await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: t.devices[0]!.id })).not.toBeNull();
    expect(await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: t.devices[1]!.id })).toBeNull();
  });

  it("biên 10 phút", async () => {
    const a = await setup();
    await sqlAsMigrator(
      `UPDATE login_tickets SET created_at = created_at - make_interval(secs => $1::double precision / 1000),
         expires_at = expires_at - make_interval(secs => $1::double precision / 1000)`,
      [10 * MIN - MARGIN],
    );
    expect(await consumeTicketAndReplace({ ticket: a.t.ticket, deviceKey: a.key, replaceDeviceId: a.t.devices[0]!.id })).not.toBeNull();

    const userId = await newUser();
    await twoDevices(userId);
    const key = newDeviceKey();
    const t = await ticket(userId, key);
    await sqlAsMigrator(
      `UPDATE login_tickets SET created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes'
       WHERE user_id = $1`,
      [userId],
    );
    expect(await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: t.devices[0]!.id })).toBeNull();
  });

  it("deviceKey khác lúc tạo vé → null", async () => {
    const { t } = await setup();
    expect(await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: newDeviceKey(), replaceDeviceId: t.devices[0]!.id })).toBeNull();
  });

  it("replaceDeviceId của người khác → null", async () => {
    const { key, t } = await setup();
    const other = await newUser();
    const { sa } = await twoDevices(other);
    const foreign = (await validateSession("learner", sa.token))!.deviceId!;
    expect(await consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: foreign })).toBeNull();
  });

  it("thiết bị đã thu hồi hoặc không tồn tại → null", async () => {
    const a = await setup();
    await prisma().device.update({ where: { id: a.t.devices[0]!.id }, data: { revokedAt: new Date() } });
    expect(await consumeTicketAndReplace({ ticket: a.t.ticket, deviceKey: a.key, replaceDeviceId: a.t.devices[0]!.id })).toBeNull();
    const b = await setup();
    expect(await consumeTicketAndReplace({ ticket: b.t.ticket, deviceKey: b.key, replaceDeviceId: crypto.randomUUID() })).toBeNull();
  });

  it("vé bị sửa → null", async () => {
    const { key, t } = await setup();
    const tampered = `${t.ticket.slice(0, -1)}${t.ticket.endsWith("A") ? "B" : "A"}`;
    expect(await consumeTicketAndReplace({ ticket: tampered, deviceKey: key, replaceDeviceId: t.devices[0]!.id })).toBeNull();
  });
});

describe("tranh chấp song song", () => {
  it("hai đăng nhập (hai khóa mới) khi còn đúng 1 chỗ → một session, một choose_device", async () => {
    const userId = await newUser();
    await session(userId, newDeviceKey());
    const results = await Promise.all([auth(userId, newDeviceKey()), auth(userId, newDeviceKey())]);
    expect(results.map((r) => r.kind).sort()).toEqual(["choose_device", "session"]);
    expect(await active(userId)).toBe(2);
  });

  it("hai vé khác nhau cùng thay một máy cũ → một thành công, một null", async () => {
    const userId = await newUser();
    const { sa } = await twoDevices(userId);
    const target = (await validateSession("learner", sa.token))!.deviceId!;
    const k1 = newDeviceKey();
    const k2 = newDeviceKey();
    const [t1, t2] = [await ticket(userId, k1), await ticket(userId, k2)];
    const results = await Promise.all([
      consumeTicketAndReplace({ ticket: t1.ticket, deviceKey: k1, replaceDeviceId: target }),
      consumeTicketAndReplace({ ticket: t2.ticket, deviceKey: k2, replaceDeviceId: target }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await active(userId)).toBe(2);
  });

  it("hai lần chọn cùng một vé → một thành công", async () => {
    const userId = await newUser();
    await twoDevices(userId);
    const key = newDeviceKey();
    const t = await ticket(userId, key);
    const results = await Promise.all(
      t.devices.map((d) => consumeTicketAndReplace({ ticket: t.ticket, deviceKey: key, replaceDeviceId: d.id })),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await active(userId)).toBe(2);
  });
});
