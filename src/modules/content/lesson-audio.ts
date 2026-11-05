import { prisma, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { putFile } from "@/modules/storage/storage";

// Chủ tải file ghi âm cho từng bài trên trang quản trị (05/11/2026). Ghi âm gắn vào phiên bản bài đang dùng trong khóa;
// bài dùng chung giữa các khóa thì khóa kia cũng có. Sửa nội dung bài giữ nguyên ghi âm (carryAssets).
// Tệp luôn là tệp bảo vệ: học viên chỉ tải qua API có kiểm quyền.

/** Dưới giới hạn thân request của nginx/Caddy (5 MB) để không cần mở rộng cấu hình máy chủ: ~4 phút mp3 128 kbps. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Nhận diện theo nội dung, không tin tên tệp. */
export function sniffAudio(b: Buffer): "audio/mpeg" | "audio/mp4" | "audio/ogg" | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";
  if (b.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  return null;
}

/** Cùng khóa với sửa bài và nhập nội dung: không gắn ghi âm vào phiên bản vừa bị thay. */
const lockContent = (tx: Tx) => tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('content-import'))`;

/** Phiên bản bài đang dùng trong khóa (theo phiên bản khóa hiện hành). */
async function lessonVersionIn(db: Tx | ReturnType<typeof prisma>, slug: string, externalId: string): Promise<string> {
  const [row] = await db.$queryRaw<{ id: string }[]>`
    SELECT lv.id::text AS id FROM courses c
    JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
    WHERE c.slug = ${slug} AND l.external_id = ${externalId}`;
  if (!row) throw new HttpError(404, "not_found");
  return row.id;
}

export type LessonAudio = { id: string; mime: string; bytes: number; createdAt: Date };

export async function listLessonAudio(ctx: AdminCtx, slug: string, externalId: string): Promise<LessonAudio[]> {
  await authorize(ctx, "orders.view", { action: "lesson_audio_list" });
  const versionId = await lessonVersionIn(prisma(), slug, externalId);
  const rows = await prisma().$queryRaw<{ id: string; mime: string; bytes: number; created_at: Date }[]>`
    SELECT ma.id::text AS id, ma.mime, ma.bytes, ma.created_at FROM lesson_version_assets lva
    JOIN media_assets ma ON ma.id = lva.media_asset_id
    WHERE lva.lesson_version_id = ${versionId}::uuid AND lva.role = 'audio' ORDER BY ma.created_at`;
  return rows.map((r) => ({ id: r.id, mime: r.mime, bytes: r.bytes, createdAt: r.created_at }));
}

export async function addLessonAudio(ctx: AdminCtx, slug: string, externalId: string, bytes: Buffer): Promise<{ id: string }> {
  await authorize(ctx, "content.edit", { action: "lesson_audio_add", resource: { type: "course", id: slug } });
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) throw new HttpError(400, "Tệp ghi âm cần nhỏ hơn 4 MB");
  const mime = sniffAudio(bytes);
  if (!mime) throw new HttpError(400, "Chỉ nhận tệp ghi âm mp3, m4a hoặc ogg");
  await lessonVersionIn(prisma(), slug, externalId);
  // Ghi tệp trước giao dịch (bất biến, theo nội dung): lỗi DB chỉ để lại tệp mồ côi, không mất dữ liệu.
  const stored = await putFile({ bytes, mime, visibility: "protected" });
  return withTx(async (tx) => {
    await lockContent(tx);
    const versionId = await lessonVersionIn(tx, slug, externalId);
    await tx.$executeRaw`
      INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key)
      VALUES (${stored.sha256}, ${mime}, ${stored.bytes}, 'protected', ${stored.storageKey}) ON CONFLICT (visibility, storage_key) DO NOTHING`;
    const [asset] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM media_assets WHERE visibility = 'protected' AND storage_key = ${stored.storageKey}`;
    const added = await tx.$executeRaw`
      INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role)
      VALUES (${versionId}::uuid, ${asset!.id}::uuid, 'audio') ON CONFLICT DO NOTHING`;
    if (added > 0) {
      await audit(tx, {
        adminId: ctx.adminId, action: "lesson_audio_add", targetType: "lesson", targetId: `${slug}/${externalId}`,
        after: { lessonVersion: versionId, asset: asset!.id, bytes: stored.bytes, mime }, result: "ok", ip: ctx.ip,
      });
    }
    return { id: asset!.id };
  });
}

export async function removeLessonAudio(ctx: AdminCtx, slug: string, externalId: string, assetId: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "lesson_audio_remove", resource: { type: "course", id: slug } });
  await withTx(async (tx) => {
    await lockContent(tx);
    const versionId = await lessonVersionIn(tx, slug, externalId);
    const removed = await tx.$executeRaw`
      DELETE FROM lesson_version_assets WHERE lesson_version_id = ${versionId}::uuid AND media_asset_id = ${assetId}::uuid AND role = 'audio'`;
    if (removed === 0) throw new HttpError(404, "not_found");
    await audit(tx, {
      adminId: ctx.adminId, action: "lesson_audio_remove", targetType: "lesson", targetId: `${slug}/${externalId}`,
      before: { lessonVersion: versionId, asset: assetId }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Tệp ghi âm cho trang quản trị nghe lại: chỉ tệp đang gắn vào một bài. */
export async function lessonAudioFile(ctx: AdminCtx, assetId: string): Promise<{ storageKey: string; mime: string } | null> {
  await authorize(ctx, "orders.view", { action: "lesson_audio_play" });
  const [row] = await prisma().$queryRaw<{ storage_key: string; mime: string }[]>`
    SELECT ma.storage_key, ma.mime FROM media_assets ma
    WHERE ma.id = ${assetId}::uuid AND ma.visibility = 'protected'
      AND EXISTS (SELECT 1 FROM lesson_version_assets lva WHERE lva.media_asset_id = ma.id)`;
  return row ? { storageKey: row.storage_key, mime: row.mime } : null;
}
