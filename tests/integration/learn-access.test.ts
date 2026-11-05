import { TEST_PAYOUT } from "../helpers/ledger";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => {
  const dir = `/tmp/me-learn-${process.pid}-${Date.now()}`;
  process.env.MEDIA_ROOT = dir;
  return dir;
});

import { prisma } from "@/lib/db";
import { GET as manifestRoute } from "@/app/api/learn/courses/[slug]/manifest/route";
import { GET as lessonRoute } from "@/app/api/learn/lessons/[lessonVersionId]/route";
import { GET as fileRoute } from "@/app/api/learn/files/[assetId]/route";
import { ingest } from "@/modules/ledger/ingest";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { advanceRefund, requestFullRefund } from "@/modules/refunds/refunds";
import { putFile } from "@/modules/storage/storage";
import { adminCtx } from "../helpers/admin-ctx";
import { adminSess } from "../helpers/admin-call";
import { paidCourseSetup, report, SLUG } from "../helpers/ledger";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

mkdirSync(path.join(root, "protected"), { recursive: true });

const BYTES = Buffer.from("âm thanh giả của bài A001 dùng để test tải tệp");

async function pay(s: Awaited<ReturnType<typeof paidCourseSetup>>) {
  expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
}

const manifest = (l: TestLearner, slug = SLUG) =>
  manifestRoute(learnerRequest(`/api/learn/courses/${slug}/manifest`, l), { params: Promise.resolve({ slug }) });
const lesson = (l: TestLearner, id: string) =>
  lessonRoute(learnerRequest(`/api/learn/lessons/${id}`, l), { params: Promise.resolve({ lessonVersionId: id }) });
function file(l: TestLearner | null, id: string, headers: Record<string, string> = {}) {
  const base = l ? learnerRequest(`/api/learn/files/${id}`, l) : new Request(`${process.env.APP_ORIGIN}/api/learn/files/${id}`);
  const h = new Headers(base.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return fileRoute(new Request(base.url, { headers: h }), { params: Promise.resolve({ assetId: id }) });
}

async function versionId(externalId: string) {
  const { rows } = await sqlAsMigrator(`SELECT lv.id FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = $1`, [externalId]);
  return rows[0].id as string;
}

/** Gắn tệp bảo vệ vào một bài. */
async function attach(externalId: string, bytes = BYTES) {
  const stored = await putFile({ bytes, mime: "audio/mpeg", visibility: "protected" });
  const { rows } = await sqlAsMigrator(
    `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'audio/mpeg', $2, 'protected', $3) RETURNING id`,
    [stored.sha256, stored.bytes, stored.storageKey],
  );
  await sqlAsMigrator(`INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role) VALUES ($1, $2, 'audio')`, [await versionId(externalId), rows[0].id]);
  return { id: rows[0].id as string, sha256: stored.sha256 };
}

describe("quyền học", () => {
  it("chưa mua: manifest 403, bài trả phí 403, bài thử 200; sau khi paid: 200 đủ 4 bài; hoàn tiền: 403 lại", async () => {
    const s = await paidCourseSetup();
    const l = s.learner;
    const paidLesson = await versionId("T001");
    const trial = await versionId("A001");
    expect((await manifest(l)).status).toBe(403);
    expect((await lesson(l, paidLesson)).status).toBe(403);
    const t = await lesson(l, trial);
    expect(t.status).toBe(200);
    expect(((await t.json()) as { contentHash: string }).contentHash).toMatch(/^[0-9a-f]{64}$/);

    await pay(s);
    const res = await manifest(l);
    expect(res.status).toBe(200);
    const m = (await res.json()) as { slug: string; versionId: string; lessons: { externalId: string; isFreeTrial: boolean; contentHash: string }[]; assets: unknown[]; totalBytes: number };
    expect(m.lessons.map((x) => x.externalId)).toEqual(["A001", "A002", "A003-1", "T001"]);
    expect((m as unknown as { titleVi: string }).titleVi).toBe("Thực tập sinh máy tàu dầu và hóa chất");
    expect(m.lessons.every((x) => x.contentHash.length === 64)).toBe(true);
    expect((await lesson(l, paidLesson)).status).toBe(200);
    // Giao diện v2: danh sách bài chia theo chủ đề của học liệu (catalog.modules), đúng thứ tự, chỉ chủ đề có bài trong khóa.
    const t2 = m as unknown as { topics: { id: string; titleVi: string }[]; lessons: { topic: string | null }[] };
    expect(t2.topics).toEqual([{ id: "A1", titleVi: "Học vấn và mục tiêu nghề nghiệp" }, { id: "B1", titleVi: "Tàu dầu và hóa chất" }]);
    expect(t2.lessons.map((x) => x.topic)).toEqual(["A1", "A1", "A1", "B1"]);

    const owner = await adminCtx("owner");
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "hoàn", payout: TEST_PAYOUT });
    if (!("refundId" in r)) throw new Error();
    await advanceRefund(owner, r.refundId, { action: "approve" });
    await advanceRefund(owner, r.refundId, { action: "send", outBankRef: "OUT-L", evidence: "x" });
    await advanceRefund(owner, r.refundId, { action: "confirm" });
    expect((await manifest(l)).status).toBe(403);
    expect((await lesson(l, paidLesson)).status).toBe(403);
    expect((await lesson(l, trial)).status).toBe(200);
  });

  it("tài khoản gộp đọc được khóa của tài khoản nguồn; khóa không tồn tại → 404; id bài sai → 404", async () => {
    const s = await paidCourseSetup();
    await pay(s);
    const b = await testLearner("B");
    expect((await manifest(b)).status).toBe(403);
    await mergeAccounts(await adminCtx("owner"), { sourceUserId: s.learner.userId, targetUserId: b.userId, reason: "gộp", preview: false });
    expect((await manifest(b)).status).toBe(200);
    expect((await manifest(b, "khong-co")).status).toBe(404);
    expect((await lesson(b, "khong-phai-uuid")).status).toBe(404);
    expect((await lesson(b, crypto.randomUUID())).status).toBe(404);
  });

  it("bài học thử của khóa chưa mở bán → 403", async () => {
    const s = await paidCourseSetup();
    await sqlAsMigrator(`UPDATE courses SET status = 'draft'`);
    expect((await lesson(s.learner, await versionId("A001"))).status).toBe(403);
  });
});

describe("tải tệp", () => {
  it("không phiên / phiên quản trị → 401; chưa có quyền → 403; có quyền → 200 đúng byte và header", async () => {
    const s = await paidCourseSetup();
    const asset = await attach("T001");
    expect((await file(null, asset.id)).status).toBe(401);
    const admin = await adminSess("owner");
    const asAdmin = await fileRoute(new Request(`${process.env.APP_ORIGIN}/api/learn/files/${asset.id}`, { headers: { cookie: `__Host-me_admin=${admin.token}` } }), { params: Promise.resolve({ assetId: asset.id }) });
    expect(asAdmin.status).toBe(401);
    expect((await file(s.learner, asset.id)).status).toBe(403);
    await pay(s);
    const res = await file(s.learner, asset.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
    const m = (await (await manifest(s.learner)).json()) as { assets: { assetId: string; sha256: string; bytes: number; role: string }[]; totalBytes: number };
    expect(m.assets).toMatchObject([{ assetId: asset.id, sha256: asset.sha256, bytes: BYTES.length, role: "audio" }]);
    expect(m.totalBytes).toBe(BYTES.length);
  });

  it("Range: 206 đúng đoạn; ngoài kích thước hoặc sai cú pháp → 416", async () => {
    const s = await paidCourseSetup();
    const asset = await attach("T001");
    await pay(s);
    const part = await file(s.learner, asset.id, { range: "bytes=0-9" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${BYTES.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(BYTES.subarray(0, 10))).toBe(true);
    const tail = await file(s.learner, asset.id, { range: "bytes=5-" });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(BYTES.subarray(5))).toBe(true);
    for (const range of ["bytes=999999-", "bytes=9-5", "abc"]) {
      const bad = await file(s.learner, asset.id, { range });
      expect(bad.status, range).toBe(416);
    }
  });

  it("id lạ → 404; tệp thuộc bài học thử: học viên chưa mua vẫn tải được", async () => {
    const s = await paidCourseSetup();
    expect((await file(s.learner, "../../etc/passwd")).status).toBe(404);
    expect((await file(s.learner, crypto.randomUUID())).status).toBe(404);
    const trial = await attach("A001", Buffer.from("tệp bài thử"));
    expect((await file(s.learner, trial.id)).status).toBe(200);
  });

  it("bản ghi trỏ tới tệp đã mất trên đĩa → 404", async () => {
    const s = await paidCourseSetup();
    const { rows } = await sqlAsMigrator(
      `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'audio/mpeg', 5, 'protected', $2) RETURNING id`,
      ["d".repeat(64), `${"d".repeat(64)}.mp3`],
    );
    await sqlAsMigrator(`INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role) VALUES ($1, $2, 'audio')`, [await versionId("A001"), rows[0].id]);
    expect((await file(s.learner, rows[0].id)).status).toBe(404);
    expect(await prisma().mediaAsset.count()).toBe(1);
  });
});


describe("tệp công khai (Codex P3 #5)", () => {
  it("manifest trả visibility + url; tệp công khai tải qua /media không cần đăng nhập; tệp bảo vệ không đi qua /media", async () => {
    const { GET: mediaRoute } = await import("@/app/media/[key]/route");
    const s = await paidCourseSetup();
    await pay(s);
    const protectedAsset = await attach("T001");
    const pub = await putFile({ bytes: Buffer.from("ảnh công khai"), mime: "image/png", visibility: "public" });
    const { rows } = await sqlAsMigrator(
      `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'image/png', $2, 'public', $3) RETURNING id`,
      [pub.sha256, pub.bytes, pub.storageKey],
    );
    await sqlAsMigrator(`INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role) VALUES ($1, $2, 'image')`, [await versionId("T001"), rows[0].id]);
    const m = (await (await manifest(s.learner)).json()) as { assets: { assetId: string; visibility: string; url: string }[] };
    expect(m.assets.find((a) => a.assetId === rows[0].id)).toMatchObject({ visibility: "public", url: `/media/${pub.storageKey}` });
    expect(m.assets.find((a) => a.assetId === protectedAsset.id)).toMatchObject({ visibility: "protected", url: `/api/learn/files/${protectedAsset.id}` });
    const res = await mediaRoute(new Request(`${process.env.APP_ORIGIN}/media/${pub.storageKey}`), { params: Promise.resolve({ key: pub.storageKey }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("ảnh công khai");
    const leaked = await mediaRoute(new Request(`${process.env.APP_ORIGIN}/media/x`), { params: Promise.resolve({ key: `${protectedAsset.sha256}.mp3` }) });
    expect(leaked.status).toBe(404);
  });
});
