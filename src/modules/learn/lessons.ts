import { prisma } from "@/lib/db";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { canReadLessonVersion } from "./entitlements";

export async function lessonContent(
  ctx: LearnerCtx,
  lessonVersionId: string,
): Promise<{ content: unknown; contentHash: string } | "forbidden" | "not_found"> {
  const [row] = await prisma().$queryRaw<{ content: unknown; content_hash: string }[]>`
    SELECT content, content_hash FROM lesson_versions WHERE id = ${lessonVersionId}::uuid`;
  if (!row) return "not_found";
  if (!(await canReadLessonVersion(ctx.userId, lessonVersionId))) return "forbidden";
  return { content: row.content, contentHash: row.content_hash };
}
