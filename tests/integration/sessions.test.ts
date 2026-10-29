import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { disconnectDb, prisma, withTx } from "@/lib/db";
import {
  cleanupSessionArtifacts,
  createSession,
  InactiveUserError,
  revokeSessionsForDevice,
  rotateIfDue,
  validateSession,
} from "@/modules/sessions/sessions";
import { csrfFor } from "@/modules/sessions/csrf";
import { pgAs } from "../helpers/pg";
import { findInDb } from "../helpers/scan";

// Thời điểm do DB sinh, nên test dịch các cột thời gian trong DB thay vì chỉnh đồng hồ.
// Biên "−1ms" được kiểm với lề 1 giây vì now() của lần kiểm sau luôn muộn hơn lúc dịch cột.
const DAY = 86_400_000;
const MIN = 60_000;
const MARGIN = 1_000;

async function sql(query: string, params: unknown[] = []) {
  const client = await pgAs("migrator");
  try {
    return await client.query(query, params);
  } finally {
    await client.end();
  }
}

/** Lùi các cột thời gian của một dòng đi ms mili giây. */
async function shiftBack(table: string, id: string, columns: string[], ms: number) {
  const sets = columns.map((c) => `"${c}" = "${c}" - make_interval(secs => $2::double precision / 1000)`).join(", ");
  await sql(`UPDATE "${table}" SET ${sets} WHERE id = $1`, [id, ms]);
}

async function newLearner() {
  const user = await prisma().user.create({ data: { displayName: "Học viên" } });
  const device = await prisma().device.create({
    data: { userId: user.id, deviceKeyHash: `dk-${user.id}`, label: "Điện thoại" },
  });
  const s = await withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt: new Date() }));
  return { user, device, ...s };
}

async function newAdmin(status = "active") {
  const { rows } = await sql(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at)
     VALUES ($1, 'owner', $2, now(), now() + interval '7 days') RETURNING id`,
    [`a${Math.random()}@x.vn`, status],
  );
  const adminId = rows[0].id as string;
  const s = await withTx((tx) => createSession(tx, { realm: "admin", adminId, authAt: new Date() }));
  return { adminId, ...s };
}

/** Đưa token về tuổi ≥ 7 ngày rồi xoay. */
async function rotate(sessionId: string) {
  await shiftBack("learner_sessions", sessionId, ["token_issued_at"], 7 * DAY);
  const next = await rotateIfDue(sessionId);
  if (!next) throw new Error("không xoay");
  return next;
}

async function sessionRow(id: string) {
  return prisma().learnerSession.findUniqueOrThrow({ where: { id } });
}

describe("phiên học viên", () => {
  it("token hợp lệ → đúng chủ thể; DB không chứa token thô", async () => {
    const s = await newLearner();
    const view = await validateSession("learner", s.token);
    expect(view).toMatchObject({ sessionId: s.sessionId, subjectId: s.user.id, deviceId: s.device.id });
    expect(view?.reissue).toBeUndefined();
    expect(s.csrf).toBe(csrfFor("learner", s.sessionId));
    expect(await findInDb(s.token)).toEqual([]);
  });

  it("token lạ → null", async () => {
    await newLearner();
    expect(await validateSession("learner", "khong-co")).toBeNull();
  });

  it("nhàn rỗi 37 ngày", async () => {
    const a = await newLearner();
    await shiftBack("learner_sessions", a.sessionId, ["last_seen_at"], 37 * DAY - MARGIN);
    expect(await validateSession("learner", a.token)).not.toBeNull();
    const b = await newLearner();
    await shiftBack("learner_sessions", b.sessionId, ["last_seen_at"], 37 * DAY);
    expect(await validateSession("learner", b.token)).toBeNull();
  });

  it("tuyệt đối 90 ngày dù dùng đều", async () => {
    const a = await newLearner();
    await shiftBack("learner_sessions", a.sessionId, ["created_at", "absolute_expires_at"], 90 * DAY - MARGIN);
    expect(await validateSession("learner", a.token)).not.toBeNull();
    const b = await newLearner();
    await shiftBack("learner_sessions", b.sessionId, ["created_at", "absolute_expires_at"], 90 * DAY);
    expect(await validateSession("learner", b.token)).toBeNull();
  });

  it("last_seen_at chỉ cập nhật khi đã ≥ 5 phút", async () => {
    const s = await newLearner();
    await shiftBack("learner_sessions", s.sessionId, ["last_seen_at"], 5 * MIN - MARGIN);
    const before = (await sessionRow(s.sessionId)).lastSeenAt;
    await validateSession("learner", s.token);
    expect((await sessionRow(s.sessionId)).lastSeenAt).toEqual(before);
    await shiftBack("learner_sessions", s.sessionId, ["last_seen_at"], MARGIN);
    await validateSession("learner", s.token);
    expect((await sessionRow(s.sessionId)).lastSeenAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("thiết bị bị thu hồi → null ngay", async () => {
    const s = await newLearner();
    await withTx((tx) => revokeSessionsForDevice(tx, s.device.id));
    await prisma().device.update({ where: { id: s.device.id }, data: { revokedAt: new Date() } });
    expect(await validateSession("learner", s.token)).toBeNull();
  });

  it("chỉ đánh dấu thiết bị thu hồi (phiên chưa bị thu hồi) cũng → null", async () => {
    const s = await newLearner();
    await prisma().device.update({ where: { id: s.device.id }, data: { revokedAt: new Date() } });
    expect(await validateSession("learner", s.token)).toBeNull();
  });

  it("user disabled hoặc merged → null ngay", async () => {
    const a = await newLearner();
    await prisma().user.update({ where: { id: a.user.id }, data: { status: "disabled" } });
    expect(await validateSession("learner", a.token)).toBeNull();
    const b = await newLearner();
    const target = await prisma().user.create({ data: { displayName: "Đích" } });
    await prisma().user.update({ where: { id: b.user.id }, data: { status: "merged", mergedIntoId: target.id } });
    expect(await validateSession("learner", b.token)).toBeNull();
  });

  it("createSession cho user không active → InactiveUserError", async () => {
    const user = await prisma().user.create({ data: { displayName: "Khóa", status: "disabled" } });
    const device = await prisma().device.create({ data: { userId: user.id, deviceKeyHash: "x", label: "y" } });
    await expect(
      withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt: new Date() })),
    ).rejects.toBeInstanceOf(InactiveUserError);
  });

  it("token học viên đưa vào khu vực quản trị → null", async () => {
    const s = await newLearner();
    expect(await validateSession("admin", s.token)).toBeNull();
  });
});

describe("xoay token học viên", () => {
  it("chưa đủ 7 ngày không xoay; đủ 7 ngày thì xoay", async () => {
    const s = await newLearner();
    await shiftBack("learner_sessions", s.sessionId, ["token_issued_at"], 7 * DAY - MARGIN);
    expect(await rotateIfDue(s.sessionId)).toBeNull();
    await shiftBack("learner_sessions", s.sessionId, ["token_issued_at"], MARGIN);
    const next = await rotateIfDue(s.sessionId);
    expect(next?.token).toBeTruthy();
    expect(next?.token).not.toBe(s.token);
    expect(next?.csrf).toBe(csrfFor("learner", s.sessionId));
    expect(await validateSession("learner", next!.token)).toMatchObject({ sessionId: s.sessionId });
    expect(await findInDb(next!.token)).toEqual([]);
  });

  it("token cũ trong cửa sổ 2 phút → hợp lệ, cấp lại token hiện tại; cả sau khi khởi động lại", async () => {
    const s = await newLearner();
    const next = await rotate(s.sessionId);
    await shiftBack("learner_sessions", s.sessionId, ["prev_valid_until"], 2 * MIN - MARGIN);
    const view = await validateSession("learner", s.token);
    expect(view?.reissue).toEqual({ token: next.token, csrf: next.csrf });
    await disconnectDb();
    expect((await validateSession("learner", s.token))?.reissue?.token).toBe(next.token);
    expect((await sessionRow(s.sessionId)).revokedAt).toBeNull();
  });

  it("token cũ khi hết cửa sổ → null và phiên bị thu hồi", async () => {
    const s = await newLearner();
    const next = await rotate(s.sessionId);
    await shiftBack("learner_sessions", s.sessionId, ["prev_valid_until"], 2 * MIN);
    expect(await validateSession("learner", s.token)).toBeNull();
    expect((await sessionRow(s.sessionId)).revokedAt).not.toBeNull();
    expect(await validateSession("learner", next.token)).toBeNull();
  });

  it("cleanupSessionArtifacts sau cửa sổ xóa phong bì", async () => {
    const s = await newLearner();
    await rotate(s.sessionId);
    await cleanupSessionArtifacts(new Date(Date.now() + 2 * MIN - MARGIN));
    expect((await sessionRow(s.sessionId)).nextTokenEnc).not.toBeNull();
    await cleanupSessionArtifacts(new Date(Date.now() + 2 * MIN + MARGIN));
    const row = await sessionRow(s.sessionId);
    expect(row.nextTokenEnc).toBeNull();
    expect(row.prevValidUntil).toBeNull();
  });

  it("xoay 3 lần, dùng token đời đầu → phiên bị thu hồi", async () => {
    const s = await newLearner();
    await rotate(s.sessionId);
    await rotate(s.sessionId);
    const third = await rotate(s.sessionId);
    expect(await validateSession("learner", s.token)).toBeNull();
    expect((await sessionRow(s.sessionId)).revokedAt).not.toBeNull();
    expect(await validateSession("learner", third.token)).toBeNull();
  });

  it("dòng lịch sử sát detect_until vẫn phát hiện; sau khi dọn quá detect_until thì chỉ null", async () => {
    const a = await newLearner();
    await rotate(a.sessionId);
    await rotate(a.sessionId);
    // Dòng lịch sử không sửa được (trigger); dọn với mốc giả định ngay trước detect_until.
    await cleanupSessionArtifacts(new Date(Date.now() + 37 * DAY - MARGIN));
    expect(await prisma().sessionTokenHistory.count({ where: { sessionId: a.sessionId } })).toBe(2);
    expect(await validateSession("learner", a.token)).toBeNull();
    expect((await sessionRow(a.sessionId)).revokedAt).not.toBeNull();

    const b = await newLearner();
    await rotate(b.sessionId);
    const current = await rotate(b.sessionId);
    await cleanupSessionArtifacts(new Date(Date.now() + 37 * DAY + MARGIN));
    expect(await prisma().sessionTokenHistory.count({ where: { sessionId: b.sessionId } })).toBe(0);
    expect(await validateSession("learner", b.token)).toBeNull();
    expect((await sessionRow(b.sessionId)).revokedAt).toBeNull();
    expect(await validateSession("learner", current.token)).not.toBeNull();
  });

  it("hai rotateIfDue song song → đúng một lần xoay", async () => {
    const s = await newLearner();
    await shiftBack("learner_sessions", s.sessionId, ["token_issued_at"], 7 * DAY);
    const results = await Promise.all([rotateIfDue(s.sessionId), rotateIfDue(s.sessionId)]);
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(await validateSession("learner", winners[0]!.token)).toMatchObject({ sessionId: s.sessionId });
    expect(await prisma().sessionTokenHistory.count({ where: { sessionId: s.sessionId } })).toBe(1);
  });
});

describe("phiên quản trị", () => {
  let admin: Awaited<ReturnType<typeof newAdmin>>;
  beforeEach(async () => {
    admin = await newAdmin();
  });
  afterEach(() => undefined);

  it("hợp lệ → đúng chủ thể; token quản trị không dùng được ở khu vực học viên", async () => {
    expect(await validateSession("admin", admin.token)).toMatchObject({ sessionId: admin.sessionId, subjectId: admin.adminId });
    expect(await validateSession("learner", admin.token)).toBeNull();
    expect(await findInDb(admin.token)).toEqual([]);
  });

  it("nhàn rỗi 1 giờ", async () => {
    await shiftBack("admin_sessions", admin.sessionId, ["last_seen_at"], 60 * MIN - MARGIN);
    expect(await validateSession("admin", admin.token)).not.toBeNull();
    const other = await newAdmin();
    await shiftBack("admin_sessions", other.sessionId, ["last_seen_at"], 60 * MIN);
    expect(await validateSession("admin", other.token)).toBeNull();
  });

  it("tuyệt đối 12 giờ", async () => {
    await shiftBack("admin_sessions", admin.sessionId, ["created_at", "absolute_expires_at"], 12 * 60 * MIN - MARGIN);
    expect(await validateSession("admin", admin.token)).not.toBeNull();
    const other = await newAdmin();
    await shiftBack("admin_sessions", other.sessionId, ["created_at", "absolute_expires_at"], 12 * 60 * MIN);
    expect(await validateSession("admin", other.token)).toBeNull();
  });

  it("quản trị không còn active → null", async () => {
    const disabled = await newAdmin("revoked");
    expect(await validateSession("admin", disabled.token)).toBeNull();
  });
});
