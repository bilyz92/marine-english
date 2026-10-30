// Gắn tệp media (audio, ảnh) vào phiên bản hiện hành của một bài trong mọi khóa. Chỉ dùng pg (CLI).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { MIME_BY_EXT, putFileAt, type Visibility } from "../modules/storage/files.ts";

export async function addMedia(
  client: pg.Client,
  input: { externalLessonId: string; filePath: string; role: "audio" | "image" | "attachment"; visibility: Visibility; root: string },
): Promise<{ attached: number }> {
  const ext = path.extname(input.filePath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`Đuôi tệp không hỗ trợ: .${ext}`);
  const { rows: versions } = await client.query<{ id: string }>(
    `SELECT DISTINCT lv.id FROM lessons l
     JOIN lesson_versions lv ON lv.lesson_id = l.id
     JOIN course_version_lessons cvl ON cvl.lesson_version_id = lv.id
     JOIN courses c ON c.current_version_id = cvl.course_version_id
     WHERE l.external_id = $1`,
    [input.externalLessonId],
  );
  if (versions.length === 0) throw new Error(`Không có bài ${input.externalLessonId} trong khóa nào`);
  const stored = await putFileAt(input.root, { bytes: await readFile(input.filePath), mime, visibility: input.visibility });
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (storage_key) DO NOTHING`,
      [stored.sha256, mime, stored.bytes, input.visibility, stored.storageKey],
    );
    let attached = 0;
    for (const v of versions) {
      const res = await client.query(
        `INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role)
         SELECT $1, id, $2 FROM media_assets WHERE storage_key = $3 ON CONFLICT DO NOTHING`,
        [v.id, input.role, stored.storageKey],
      );
      attached += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { attached };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
