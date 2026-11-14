import { prisma, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { putStream } from "@/modules/storage/storage";
import { StreamRejected, StreamTooLarge } from "@/modules/storage/files";
import { MAX_VIDEO_BYTES, sniffVideo } from "./video-format";

// Bài video (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 2): mỗi phiên bản bài tối đa một tệp video bảo vệ (role 'video').
// Tệp tải lên theo luồng, ghi thẳng xuống đĩa; học viên phát qua /api/learn/files/<id> (kiểm quyền, Range), khách xem bài học thử
// qua /api/public/courses/<slug>/trial/<vị trí>/video. Tệp đi theo bài sang phiên bản mới khi sửa bài (saveLesson chép mọi tệp gắn kèm).

/** Cùng khóa với sửa bài và nhập nội dung: không gắn video vào phiên bản vừa bị thay. */
const lockContent = (tx: Tx) => tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('content-import'))`;

/** Phiên bản bài đang dùng trong khóa và loại bài của nó. */
async function currentLesson(db: Tx | ReturnType<typeof prisma>, slug: string, externalId: string): Promise<{ id: string; isVideo: boolean }> {
  const [row] = await db.$queryRaw<{ id: string; lesson_type: string | null }[]>`
    SELECT lv.id::text AS id, lv.content ->> 'lesson_type' AS lesson_type FROM courses c
    JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
    WHERE c.slug = ${slug} AND l.external_id = ${externalId}`;
  if (!row) throw new HttpError(404, "not_found");
  return { id: row.id, isVideo: row.lesson_type === "video" };
}

export type LessonVideo = { id: string; mime: string; bytes: number; createdAt: Date };

export async function listLessonVideo(ctx: AdminCtx, slug: string, externalId: string): Promise<LessonVideo[]> {
  await authorize(ctx, "orders.view", { action: "lesson_video_list" });
  const lesson = await currentLesson(prisma(), slug, externalId);
  const rows = await prisma().$queryRaw<{ id: string; mime: string; bytes: number; created_at: Date }[]>`
    SELECT ma.id::text AS id, ma.mime, ma.bytes, ma.created_at FROM lesson_version_assets lva
    JOIN media_assets ma ON ma.id = lva.media_asset_id
    WHERE lva.lesson_version_id = ${lesson.id}::uuid AND lva.role = 'video' ORDER BY ma.created_at`;
  return rows.map((r) => ({ id: r.id, mime: r.mime, bytes: r.bytes, createdAt: r.created_at }));
}

/** Tải tệp video (luồng thô) lên bài video; thay tệp cũ nếu có. */
export async function setLessonVideo(ctx: AdminCtx, slug: string, externalId: string, stream: ReadableStream<Uint8Array>): Promise<{ id: string }> {
  await authorize(ctx, "content.edit", { action: "lesson_video_set", resource: { type: "course", id: slug } });
  if (!(await currentLesson(prisma(), slug, externalId)).isVideo) throw new HttpError(400, "not_video_lesson");
  // Ghi tệp trước giao dịch (bất biến, theo nội dung; có thể mất nhiều phút): không giữ khóa nội dung trong lúc tải.
  // shortcut: tệp cũ (bị thay, bị gỡ, hoặc DB lỗi sau khi ghi) ở lại trên đĩa, như ghi âm; dọn bằng job có kiểm tham chiếu khi đĩa
  // bắt đầu chật (docs/runbook.md, mục Video, có câu SQL liệt kê tệp video không còn gắn bài).
  let stored: Awaited<ReturnType<typeof putStream>>;
  try {
    stored = await putStream({ stream, visibility: "protected", maxBytes: MAX_VIDEO_BYTES, sniff: sniffVideo });
  } catch (error) {
    if (error instanceof StreamTooLarge) throw new HttpError(413, "Tệp video lớn hơn 300 MB");
    if (error instanceof StreamRejected) throw new HttpError(400, "Chỉ nhận tệp video mp4 hoặc webm");
    throw error;
  }
  return withTx(async (tx) => {
    await lockContent(tx);
    // Kiểm lại sau khi khóa: trong lúc tải, chủ có thể đã sửa bài (phiên bản mới) hoặc đổi sang loại khác.
    const lesson = await currentLesson(tx, slug, externalId);
    if (!lesson.isVideo) throw new HttpError(400, "not_video_lesson");
    await tx.$executeRaw`
      INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key)
      VALUES (${stored.sha256}, ${stored.mime}, ${stored.bytes}, 'protected', ${stored.storageKey}) ON CONFLICT (visibility, storage_key) DO NOTHING`;
    const [asset] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM media_assets WHERE visibility = 'protected' AND storage_key = ${stored.storageKey}`;
    const old = await tx.$queryRaw<{ id: string }[]>`
      DELETE FROM lesson_version_assets WHERE lesson_version_id = ${lesson.id}::uuid AND role = 'video' RETURNING media_asset_id::text AS id`;
    await tx.$executeRaw`
      INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role) VALUES (${lesson.id}::uuid, ${asset!.id}::uuid, 'video')`;
    await audit(tx, {
      adminId: ctx.adminId, action: "lesson_video_set", targetType: "lesson", targetId: `${slug}/${externalId}`,
      before: { lessonVersion: lesson.id, assets: old.map((o) => o.id) },
      after: { lessonVersion: lesson.id, asset: asset!.id, bytes: stored.bytes, mime: stored.mime }, result: "ok", ip: ctx.ip,
    });
    return { id: asset!.id };
  });
}

export async function removeLessonVideo(ctx: AdminCtx, slug: string, externalId: string, assetId: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "lesson_video_remove", resource: { type: "course", id: slug } });
  await withTx(async (tx) => {
    await lockContent(tx);
    const lesson = await currentLesson(tx, slug, externalId);
    const removed = await tx.$executeRaw`
      DELETE FROM lesson_version_assets WHERE lesson_version_id = ${lesson.id}::uuid AND media_asset_id = ${assetId}::uuid AND role = 'video'`;
    if (removed === 0) throw new HttpError(404, "not_found");
    await audit(tx, {
      adminId: ctx.adminId, action: "lesson_video_remove", targetType: "lesson", targetId: `${slug}/${externalId}`,
      before: { lessonVersion: lesson.id, asset: assetId }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Tệp video của đúng một bài học thử (khóa đang bán, vị trí học thử của phiên bản hiện hành); khác → null. */
export async function trialVideo(slug: string, position: number): Promise<{ storageKey: string; mime: string } | null> {
  if (!Number.isInteger(position) || position < 1) return null;
  const [row] = await prisma().$queryRaw<{ storage_key: string; mime: string }[]>`
    SELECT ma.storage_key, ma.mime FROM courses c
    JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    JOIN lesson_version_assets lva ON lva.lesson_version_id = cvl.lesson_version_id AND lva.role = 'video'
    JOIN media_assets ma ON ma.id = lva.media_asset_id AND ma.visibility = 'protected'
    WHERE c.slug = ${slug} AND c.status = 'published' AND cvl.position = ${position} AND cvl.is_free_trial
    LIMIT 1`;
  return row ? { storageKey: row.storage_key, mime: row.mime } : null;
}
