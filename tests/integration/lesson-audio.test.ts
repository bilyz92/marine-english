import { describe, expect, it } from "vitest";
import { GET as listAudio, POST as uploadAudio, DELETE as removeAudio } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/audio/route";
import { GET as courseLessons } from "@/app/api/quan-tri/content/courses/[slug]/route";
import { PUT as putLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/route";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";
import { readFileSync } from "node:fs";
import { importContent } from "@/worker/content-import";

// Chủ tải file ghi âm cho từng bài trên trang quản trị (04/11/2026). Ghi âm gắn với bài, giữ nguyên khi sửa nội dung bài.

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from("am-thanh-thu")]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypM4A "), Buffer.from("am-thanh-m4a")]);

function upload(s: AdminSess, slug: string, externalId: string, bytes: Buffer, name = "bai.mp3") {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes)]), name);
  return uploadAudio(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/content/courses/${slug}/lessons/${externalId}/audio`, {
    method: "POST", body: form,
    headers: { cookie: `__Host-me_admin=${s.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": s.csrf },
  }), { params: Promise.resolve({ slug, externalId }) });
}
const list = async (s: AdminSess, slug: string, externalId: string) => {
  const res = await callAdmin(listAudio, s, "GET", "/x", undefined, { slug, externalId });
  expect(res.status).toBe(200);
  return ((await res.json()) as { audio: { id: string; bytes: number; mime: string }[] }).audio;
};
const remove = (s: AdminSess, slug: string, externalId: string, id: string) =>
  callAdmin(removeAudio, s, "DELETE", `/x?asset=${id}`, undefined, { slug, externalId });
/** Tệp âm thanh của bài trong phiên bản khóa hiện tại (đúng những gì manifest gửi cho học viên). */
const current = async (slug: string, externalId: string) =>
  (await sqlAsMigrator(
    `SELECT ma.id, ma.visibility FROM courses c
     JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
     JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
     JOIN lesson_version_assets lva ON lva.lesson_version_id = lv.id AND lva.role = 'audio'
     JOIN media_assets ma ON ma.id = lva.media_asset_id
     WHERE c.slug = $1 AND l.external_id = $2`, [slug, externalId])).rows as { id: string; visibility: string }[];
const versionOf = async (s: AdminSess, slug: string) =>
  ((await (await callAdmin(courseLessons, s, "GET", "/x", undefined, { slug })).json()) as { course: { currentVersionId: string } }).course.currentVersionId;

describe("ghi âm cho từng bài (quản trị)", () => {
  it("chủ tải mp3: bài có ghi âm (tệp bảo vệ), danh sách hiện, có nhật ký; tải lại cùng tệp không thêm bản trùng", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await upload(owner, "engine_cadet_tanker", "A002", MP3);
    expect(res.status).toBe(200);
    const audio = await list(owner, "engine_cadet_tanker", "A002");
    expect(audio).toHaveLength(1);
    expect(audio[0]).toMatchObject({ mime: "audio/mpeg", bytes: MP3.length });
    expect(await current("engine_cadet_tanker", "A002")).toEqual([{ id: audio[0]!.id, visibility: "protected" }]);
    expect((await auditRows("lesson_audio_add")).length).toBe(1);
    expect((await upload(owner, "engine_cadet_tanker", "A002", MP3)).status).toBe(200);
    expect(await list(owner, "engine_cadet_tanker", "A002")).toHaveLength(1);
    expect((await upload(owner, "engine_cadet_tanker", "A002", M4A, "bai.m4a")).status).toBe(200);
    expect((await list(owner, "engine_cadet_tanker", "A002")).map((a) => a.mime).sort()).toEqual(["audio/mp4", "audio/mpeg"]);
  });

  it("không phải tệp âm thanh (đổi đuôi .mp3) → 400, không lưu gì", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await upload(owner, "engine_cadet_tanker", "A003-1", Buffer.from("%PDF-1.4 khong phai am thanh"), "gia.mp3");
    expect(res.status).toBe(400);
    expect(await current("engine_cadet_tanker", "A003-1")).toEqual([]);
  });

  it("người hỗ trợ không tải, không gỡ được (403)", async () => {
    await seedContent();
    const support = await adminSess("support");
    expect((await upload(support, "engine_cadet_tanker", "A002", MP3)).status).toBe(403);
    expect(await current("engine_cadet_tanker", "A002")).toEqual([]);
  });

  it("bài không có trong khóa → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await upload(owner, "engine_cadet_tanker", "H001", MP3)).status).toBe(404);
  });

  it("sửa nội dung bài trên web: ghi âm vẫn còn ở phiên bản mới", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await upload(owner, "engine_cadet_tanker", "A002", MP3)).status).toBe(200);
    const res = await callAdmin(putLesson, owner, "PUT", "/x", {
      expectedVersionId: await versionOf(owner, "engine_cadet_tanker"),
      questionEn: "Why did you choose engineering?", questionVi: "Vì sao chọn ngành máy?", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    }, { slug: "engine_cadet_tanker", externalId: "A002" });
    expect(res.status).toBe(200);
    expect(await current("engine_cadet_tanker", "A002")).toHaveLength(1);
  });

  it("nhập lại file nội dung có sửa bài: ghi âm vẫn còn ở phiên bản mới", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await upload(owner, "engine_cadet_tanker", "A002", MP3)).status).toBe(200);
    const data = JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8"));
    const lesson = data.lessons.find((l: { id: string }) => l.id === "A002");
    lesson.question.text.en = `${lesson.question.text.en} (sửa)`;
    const client = await pgAs("migrator");
    try {
      await importContent(client, data);
    } finally {
      await client.end();
    }
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'A002'`)).rows[0].n).toBe(2);
    expect(await current("engine_cadet_tanker", "A002")).toHaveLength(1);
  });

  it("nhập lại đúng nội dung một phiên bản cũ (dùng lại phiên bản đó): ghi âm của phiên bản đang dùng vẫn đi theo", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await callAdmin(putLesson, owner, "PUT", "/x", {
      expectedVersionId: await versionOf(owner, "engine_cadet_tanker"),
      questionEn: "Why did you choose engineering?", questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    }, { slug: "engine_cadet_tanker", externalId: "A002" });
    expect(res.status).toBe(200);
    expect((await upload(owner, "engine_cadet_tanker", "A002", MP3)).status).toBe(200);
    const client = await pgAs("migrator");
    try {
      await importContent(client, JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8")));
    } finally {
      await client.end();
    }
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'A002'`)).rows[0].n).toBe(2);
    expect(await current("engine_cadet_tanker", "A002")).toHaveLength(1);
  });

  it("nhập dữ liệu chỉ của một khóa: không chép ghi âm từ khóa khác đang dùng phiên bản bài khác", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    // Khóa dry_cargo sửa A002 (phiên bản riêng) và gắn ghi âm; khóa tanker vẫn dùng phiên bản gốc.
    expect((await callAdmin(putLesson, owner, "PUT", "/x", {
      expectedVersionId: await versionOf(owner, "engine_cadet_dry_cargo"),
      questionEn: "Riêng của dry cargo", questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    }, { slug: "engine_cadet_dry_cargo", externalId: "A002" })).status).toBe(200);
    expect((await upload(owner, "engine_cadet_dry_cargo", "A002", MP3)).status).toBe(200);
    const data = JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8"));
    data.courses = data.courses.filter((c: { id: string }) => c.id === "engine_cadet_tanker");
    data.lessons.find((l: { id: string }) => l.id === "A002").question.text.en += " (tanker sửa)";
    const client = await pgAs("migrator");
    try {
      await importContent(client, data);
    } finally {
      await client.end();
    }
    expect(await current("engine_cadet_tanker", "A002")).toEqual([]);
    expect(await current("engine_cadet_dry_cargo", "A002")).toHaveLength(1);
  });

  it("gỡ ghi âm: bài không còn tệp đó, có nhật ký; gỡ tệp không thuộc bài → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await upload(owner, "engine_cadet_tanker", "A002", MP3);
    const [a] = await list(owner, "engine_cadet_tanker", "A002");
    expect((await remove(owner, "engine_cadet_tanker", "A003-1", a!.id)).status).toBe(404);
    expect((await remove(owner, "engine_cadet_tanker", "A002", a!.id)).status).toBe(200);
    expect(await current("engine_cadet_tanker", "A002")).toEqual([]);
    expect((await auditRows("lesson_audio_remove")).length).toBe(1);
  });
});
