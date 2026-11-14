import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Bài video (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 2): tệp video bảo vệ tải lên theo luồng, link YouTube,
// phát có kiểm quyền (Range), học thử cho khách.

const root = vi.hoisted(() => {
  const dir = `/tmp/me-video-${process.pid}-${Date.now()}`;
  process.env.MEDIA_ROOT = dir;
  return dir;
});

import { GET as listVideo, POST as uploadVideoRoute, DELETE as removeVideo } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/video/route";
import { GET as trialVideoRoute } from "@/app/api/public/courses/[slug]/trial/[position]/video/route";
import { GET as courseLessons } from "@/app/api/quan-tri/content/courses/[slug]/route";
import { PUT as putLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/route";
import { POST as addLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/route";
import { GET as fileRoute } from "@/app/api/learn/files/[assetId]/route";
import { GET as manifestRoute } from "@/app/api/learn/courses/[slug]/manifest/route";
import { GET as publicCourse } from "@/app/api/public/courses/[slug]/route";
import { GET as trialLesson } from "@/app/api/public/courses/[slug]/trial/[position]/route";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { publish, seedContent } from "../helpers/content";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

mkdirSync(path.join(root, "protected"), { recursive: true });

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12), Buffer.from("video-thu-".repeat(30))]);
const MP4_B = Buffer.concat([MP4, Buffer.from("ban-khac")]);
const YT = "dQw4w9WgXcQ";
const YT_PAID = "aBcDeFgHiJk";
const SLUG = "engine_cadet_tanker";

function upload(s: AdminSess, externalId: string, bytes: Buffer, headers: Record<string, string> = {}) {
  return uploadVideoRoute(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/content/courses/${SLUG}/lessons/${externalId}/video`, {
    method: "POST", body: new Uint8Array(bytes),
    headers: { cookie: `__Host-me_admin=${s.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": s.csrf, "content-length": String(bytes.length), ...headers },
  }), { params: Promise.resolve({ slug: SLUG, externalId }) });
}
const list = async (s: AdminSess, externalId: string) => {
  const res = await callAdmin(listVideo, s, "GET", "/x", undefined, { slug: SLUG, externalId });
  expect(res.status).toBe(200);
  return ((await res.json()) as { video: { id: string; bytes: number; mime: string }[] }).video;
};
const versionOf = async (s: AdminSess) =>
  ((await (await callAdmin(courseLessons, s, "GET", "/x", undefined, { slug: SLUG })).json()) as { course: { currentVersionId: string } }).course.currentVersionId;
const fields = { questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [] };
/** Đổi bài có sẵn thành bài video. */
const makeVideo = async (s: AdminSess, externalId: string, youtubeUrl = "", title = "Engine room tour") =>
  callAdmin(putLesson, s, "PUT", "/x", { ...fields, questionEn: title, lessonType: "video", youtubeUrl, expectedVersionId: await versionOf(s), confirmLive: true }, { slug: SLUG, externalId });
const contentOf = async (externalId: string) =>
  (await sqlAsMigrator(
    `SELECT lv.content FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
     JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id WHERE c.slug = $1 AND l.external_id = $2`, [SLUG, externalId])).rows[0]?.content;
const videoAssets = async (externalId: string) =>
  (await sqlAsMigrator(
    `SELECT ma.id, ma.visibility, ma.mime FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
     JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
     JOIN lesson_version_assets lva ON lva.lesson_version_id = lv.id AND lva.role = 'video' JOIN media_assets ma ON ma.id = lva.media_asset_id
     WHERE c.slug = $1 AND l.external_id = $2`, [SLUG, externalId])).rows as { id: string; visibility: string; mime: string }[];
const tmpLeft = () => readdirSync(path.join(root, "protected")).filter((f) => f.startsWith(".tmp-"));
async function grant(userId: string, courseId: string) {
  const owner = await adminSess("owner");
  await sqlAsMigrator(`INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by) VALUES ($1, $2, 'grant', 'học thử nội bộ', $3)`, [userId, courseId, owner.adminId]);
}
const getFile = (l: Awaited<ReturnType<typeof testLearner>>, id: string, range?: string) => {
  const req = learnerRequest(`/api/learn/files/${id}`, l);
  const headers = new Headers(req.headers);
  if (range) headers.set("range", range);
  return fileRoute(new Request(req.url, { headers }), { params: Promise.resolve({ assetId: id }) });
};
const getTrial = (slug: string, position: string, range?: string) =>
  trialVideoRoute(new Request(`${process.env.APP_ORIGIN}/api/public/courses/${slug}/trial/${position}/video`, { headers: range ? { range } : {} }), { params: Promise.resolve({ slug, position }) });

describe("bài video: soạn bài", () => {
  it("bài video có link YouTube: nội dung có lesson_type video và mã 11 ký tự, không cần đáp án mẫu", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await makeVideo(owner, "A002", `https://youtu.be/${YT}?si=x`)).status).toBe(200);
    const c = await contentOf("A002");
    expect(c.lesson_type).toBe("video");
    expect(c.video).toEqual({ youtube_id: YT });
    const listing = (await (await callAdmin(courseLessons, owner, "GET", "/x", undefined, { slug: SLUG })).json()) as { lessons: { externalId: string; lessonType: string; hasVideo: boolean }[] };
    expect(listing.lessons.find((l) => l.externalId === "A002")).toMatchObject({ lessonType: "video", hasVideo: true });
    expect(listing.lessons.find((l) => l.externalId === "A001")).toMatchObject({ lessonType: "qa", hasVideo: false });
  });

  it("link YouTube sai → 400 youtube_invalid; đổi bài video về hỏi–đáp → bỏ lesson_type và video", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const bad = await makeVideo(owner, "A002", "https://vimeo.com/12345");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("youtube_invalid");
    expect((await makeVideo(owner, "A002", `https://www.youtube.com/watch?v=${YT}`)).status).toBe(200);
    expect((await callAdmin(putLesson, owner, "PUT", "/x", { ...fields, questionEn: "Back to QA", lessonType: "qa", youtubeUrl: `https://youtu.be/${YT}`, expectedVersionId: await versionOf(owner) }, { slug: SLUG, externalId: "A002" })).status).toBe(200);
    const c = await contentOf("A002");
    expect(c.lesson_type).toBeUndefined();
    expect(c.video).toBeUndefined();
  });

  it("thêm bài video mới cuối khóa không có link: được (tải tệp sau)", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await callAdmin(addLesson, owner, "POST", "/x", { ...fields, questionEn: "Purifier overhaul", lessonType: "video", youtubeUrl: "", expectedVersionId: await versionOf(owner) }, { slug: SLUG });
    expect(res.status).toBe(200);
    const { externalId } = (await res.json()) as { externalId: string };
    expect((await contentOf(externalId)).lesson_type).toBe("video");
  });
});

describe("bài video: tải tệp lên (quản trị)", () => {
  it("chủ tải mp4 thô: tệp bảo vệ, role video, nhật ký; tệp khác thay tệp cũ; gỡ → không còn", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A002");
    const res = await upload(owner, "A002", MP4);
    expect(res.status).toBe(200);
    const [v] = await list(owner, "A002");
    expect(v).toMatchObject({ mime: "video/mp4", bytes: MP4.length });
    expect(await videoAssets("A002")).toEqual([{ id: v!.id, visibility: "protected", mime: "video/mp4" }]);
    expect((await auditRows("lesson_video_set")).length).toBe(1);
    expect((await upload(owner, "A002", MP4_B)).status).toBe(200);
    const after = await list(owner, "A002");
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(v!.id);
    expect((await callAdmin(removeVideo, owner, "DELETE", `/x?asset=${v!.id}`, undefined, { slug: SLUG, externalId: "A002" })).status).toBe(404);
    expect((await callAdmin(removeVideo, owner, "DELETE", `/x?asset=${after[0]!.id}`, undefined, { slug: SLUG, externalId: "A002" })).status).toBe(200);
    expect(await videoAssets("A002")).toEqual([]);
    expect((await auditRows("lesson_video_remove")).length).toBe(1);
    expect(tmpLeft()).toEqual([]);
  });

  it("bài không phải video → 400 not_video_lesson; tệp không phải video → 400, không để lại tệp tạm", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const notVideo = await upload(owner, "A002", MP4);
    expect(notVideo.status).toBe(400);
    expect(((await notVideo.json()) as { error: string }).error).toBe("not_video_lesson");
    await makeVideo(owner, "A002");
    expect((await upload(owner, "A002", Buffer.from("ID3 khong phai video".padEnd(6000, "x")))).status).toBe(400);
    expect(await videoAssets("A002")).toEqual([]);
    expect(tmpLeft()).toEqual([]);
  });

  it("thiếu content-length → 411; khai > 300 MB → 413", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A002");
    const noLength = await uploadVideoRoute(new Request(`${process.env.APP_ORIGIN}/x`, {
      method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MP4)); c.close(); } }), duplex: "half",
      headers: { cookie: `__Host-me_admin=${owner.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": owner.csrf },
    } as RequestInit), { params: Promise.resolve({ slug: SLUG, externalId: "A002" }) });
    expect(noLength.status).toBe(411);
    expect((await upload(owner, "A002", MP4, { "content-length": String(300 * 1024 * 1024 + 1) })).status).toBe(413);
  });

  it("người hỗ trợ xem được, tải lên → 403; không phiên → 401; thiếu CSRF → 403", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A002");
    const support = await adminSess("support");
    expect(await list(support, "A002")).toEqual([]);
    expect((await upload(support, "A002", MP4)).status).toBe(403);
    const anon = await uploadVideoRoute(new Request(`${process.env.APP_ORIGIN}/x`, { method: "POST", body: new Uint8Array(MP4), headers: { origin: process.env.APP_ORIGIN!, "content-length": String(MP4.length) } }), { params: Promise.resolve({ slug: SLUG, externalId: "A002" }) });
    expect(anon.status).toBe(401);
    expect((await upload(owner, "A002", MP4, { "x-csrf-token": "sai" })).status).toBe(403);
    expect(await videoAssets("A002")).toEqual([]);
  });

  it("chủ đổi bài sang hỏi–đáp trong lúc đang tải video lên → 400 not_video_lesson, bài không có video", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A002");
    let finish!: () => void;
    let started!: () => void;
    const firstChunkSent = new Promise<void>((r) => { started = r; });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(MP4.subarray(0, 100)));
        started();
        finish = () => { c.enqueue(new Uint8Array(MP4.subarray(100))); c.close(); };
      },
    });
    const pending = uploadVideoRoute(new Request(`${process.env.APP_ORIGIN}/x`, {
      method: "POST", body, duplex: "half",
      headers: { cookie: `__Host-me_admin=${owner.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": owner.csrf, "content-length": String(MP4.length) },
    } as RequestInit), { params: Promise.resolve({ slug: SLUG, externalId: "A002" }) });
    await firstChunkSent;
    expect((await callAdmin(putLesson, owner, "PUT", "/x", { ...fields, questionEn: "Now QA", lessonType: "qa", expectedVersionId: await versionOf(owner), confirmLive: true }, { slug: SLUG, externalId: "A002" })).status).toBe(200);
    finish();
    const res = await pending;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("not_video_lesson");
    expect(await videoAssets("A002")).toEqual([]);
  });

  it("sửa nội dung bài video: tệp video đi theo phiên bản mới", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A002");
    await upload(owner, "A002", MP4);
    expect((await makeVideo(owner, "A002", "", "Engine room tour (sửa)")).status).toBe(200);
    expect(await videoAssets("A002")).toHaveLength(1);
  });

  it("ràng buộc DB: role video và tệp tới 300 MB nhận, 300 MB + 1 bị từ chối", async () => {
    const c = await pgAs("app");
    try {
      const sha = "a".repeat(64);
      await c.query(`INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'video/mp4', 314572800, 'protected', $2)`, [sha, `${sha}.mp4`]);
      await expect(c.query(`INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'video/mp4', 314572801, 'protected', $2)`, ["b".repeat(64), `${"b".repeat(64)}.mp4`])).rejects.toThrow();
      // Tệp video không bao giờ công khai.
      await expect(c.query(`INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'video/webm', 10, 'public', $2)`, ["c".repeat(64), `${"c".repeat(64)}.webm`])).rejects.toThrow();
    } finally {
      await c.end();
    }
  });
});

describe("bài video: phát và quyền", () => {
  it("học viên có quyền: Range 206; manifest có lessonType video và tệp role video; học viên không mua → 403", async () => {
    const ids = await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "T001", `https://youtu.be/${YT_PAID}`);
    await upload(owner, "T001", MP4);
    const [v] = await videoAssets("T001");
    const buyer = await testLearner();
    await grant(buyer.userId, ids[SLUG]!);
    const part = await getFile(buyer, v!.id, "bytes=0-9");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${MP4.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(MP4.subarray(0, 10))).toBe(true);
    expect((await getFile(buyer, v!.id, `bytes=${MP4.length}-`)).status).toBe(416);
    const manifest = (await (await manifestRoute(learnerRequest(`/api/learn/courses/${SLUG}/manifest`, buyer), { params: Promise.resolve({ slug: SLUG }) })).json()) as {
      lessons: { externalId: string; lessonType: string }[]; assets: { assetId: string; role: string; url: string }[];
    };
    expect(manifest.lessons.find((l) => l.externalId === "T001")!.lessonType).toBe("video");
    expect(manifest.assets).toContainEqual(expect.objectContaining({ assetId: v!.id, role: "video", url: `/api/learn/files/${v!.id}` }));
    const stranger = await testLearner();
    expect((await getFile(stranger, v!.id, "bytes=0-9")).status).toBe(403);
  });

  it("học thử: khóa đang bán, bài video vị trí 1 → 206 cho khách; vị trí 4 (không học thử) → 404; khóa nháp → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "A001");
    await upload(owner, "A001", MP4);
    await makeVideo(owner, "T001");
    await upload(owner, "T001", MP4_B);
    expect((await getTrial(SLUG, "1", "bytes=0-")).status).toBe(404);
    await publish(SLUG);
    const res = await getTrial(SLUG, "1", "bytes=100-199");
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect((await getTrial(SLUG, "4", "bytes=0-")).status).toBe(404);
    expect((await getTrial(SLUG, "2")).status).toBe(404);
    expect((await getTrial(SLUG, "abc")).status).toBe(404);
  });

  it("người chưa mua: API trang khóa không có mã YouTube, mã tệp hay tiêu đề bài video trả phí; API học thử bài 4 → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await makeVideo(owner, "T001", `https://youtu.be/${YT_PAID}`, "Secret paid video title");
    await upload(owner, "T001", MP4);
    const [v] = await videoAssets("T001");
    await publish(SLUG);
    const body = await (await publicCourse(new Request(`${process.env.APP_ORIGIN}/api/public/courses/${SLUG}`), { params: Promise.resolve({ slug: SLUG }) })).text();
    expect(body).not.toContain(YT_PAID);
    expect(body).not.toContain(v!.id);
    expect(body).not.toContain("Secret paid video title");
    expect((await trialLesson(new Request(`${process.env.APP_ORIGIN}/x`), { params: Promise.resolve({ slug: SLUG, position: "4" }) })).status).toBe(404);
  });
});
