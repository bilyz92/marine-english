import { createHash } from "node:crypto";
import { z } from "zod";
import { withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { canReadLessonVersion, entitledCourses, type EntitledCourse } from "./entitlements";
import { issueLicense } from "./license";
import { bumpProgress, type ProgressChange } from "./progress";

// Đồng bộ sự kiện học — TD §6. Thiết bị lấy từ phiên. Một transaction mỗi lô, mỗi sự kiện một savepoint: lỗi một sự kiện không hủy cả lô.

export const MAX_EVENTS = 200;
// Lô lớn nhất nhiều câu lệnh hơn mức 5 giây mặc định của một transaction.
const SYNC_TX_TIMEOUT_MS = 30_000;

const Base = {
  eventId: z.uuid(),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lessonVersionId: z.uuid(),
  clientTime: z.iso.datetime({ offset: true }).optional(),
};
const Score = z.number().int().min(0).max(100);
const LearningEvent = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("lesson_opened"), payload: z.object({}).loose() }),
  z.object({ ...Base, type: z.literal("activity_completed"), payload: z.object({ activityId: z.string().min(1).max(100) }).loose() }),
  z.object({ ...Base, type: z.literal("lesson_completed"), payload: z.object({ scorePct: Score.optional() }).loose() }),
  z.object({ ...Base, type: z.literal("quiz_attempt"), payload: z.object({ scorePct: Score }).loose() }),
]);
type LearningEvent = z.infer<typeof LearningEvent>;

export type EventStatus = "accepted" | "duplicate" | "rejected" | "retryable";
export type EventResult = { eventId: string | null; status: EventStatus; reason?: string };
export type SyncResult = {
  results: EventResult[];
  license: string;
  courses: { id: string; slug: string; versionId: string }[];
  revokedCourseIds: string[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const hashEvent = (e: LearningEvent) =>
  createHash("sha256").update(canonical({ seq: e.seq, type: e.type, lessonVersionId: e.lessonVersionId, payload: e.payload })).digest("hex");

function progressChange(e: LearningEvent): ProgressChange {
  switch (e.type) {
    case "lesson_opened":
      return { status: "in_progress" };
    case "activity_completed":
      return { status: "in_progress", activityId: e.payload.activityId };
    case "lesson_completed":
      return { status: "completed", scorePct: e.payload.scorePct };
    case "quiz_attempt":
      return { status: "in_progress", scorePct: e.payload.scorePct };
  }
}

async function recordEvent(tx: Tx, ctx: LearnerCtx, e: LearningEvent, enrolled: EntitledCourse[]): Promise<EventResult> {
  const hash = hashEvent(e);
  const rejected = (reason: string): EventResult => ({ eventId: e.eventId, status: "rejected", reason });
  const [same] = await tx.$queryRaw<{ user_id: string; payload_hash: string }[]>`
    SELECT user_id, payload_hash FROM learning_events WHERE event_id = ${e.eventId}::uuid`;
  if (same) {
    return same.user_id === ctx.userId && same.payload_hash === hash ? { eventId: e.eventId, status: "duplicate" } : rejected("event_id_conflict");
  }
  const [seqTaken] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM learning_events WHERE device_id = ${ctx.deviceId}::uuid AND seq = ${e.seq}`;
  if (seqTaken) return rejected("seq_conflict");
  const [lesson] = await tx.$queryRaw<{ lesson_id: string }[]>`
    SELECT lesson_id FROM lesson_versions WHERE id = ${e.lessonVersionId}::uuid`;
  if (!lesson) return rejected("lesson_not_found");

  // Quyền xét lúc máy chủ nhận. Hết quyền: vẫn lưu làm lịch sử nhưng không mở thêm gì.
  const entitled = await canReadLessonVersion(ctx.userId, e.lessonVersionId, tx);
  const [course] = await tx.$queryRaw<{ course_id: string }[]>`
    SELECT cv.course_id FROM course_version_lessons cvl JOIN course_versions cv ON cv.id = cvl.course_version_id
    WHERE cvl.lesson_version_id = ${e.lessonVersionId}::uuid AND cv.course_id = ANY(${enrolled.map((c) => c.courseId)}::uuid[])
    LIMIT 1`;
  await tx.$executeRaw`
    INSERT INTO learning_events (event_id, user_id, device_id, seq, lesson_version_id, course_id, type, payload, payload_hash, client_time, entitlement_ok)
    VALUES (${e.eventId}::uuid, ${ctx.userId}::uuid, ${ctx.deviceId}::uuid, ${e.seq}, ${e.lessonVersionId}::uuid, ${course?.course_id ?? null}::uuid,
            ${e.type}, ${JSON.stringify(e.payload)}::jsonb, ${hash}, ${e.clientTime ?? null}::timestamptz, ${entitled})`;
  if (e.type === "quiz_attempt") {
    await tx.$executeRaw`
      INSERT INTO quiz_attempts (event_id, user_id, lesson_id, score_pct)
      VALUES (${e.eventId}::uuid, ${ctx.userId}::uuid, ${lesson.lesson_id}::uuid, ${e.payload.scorePct})`;
  }
  if (entitled) await bumpProgress(tx, ctx.userId, lesson.lesson_id, progressChange(e));
  return { eventId: e.eventId, status: "accepted" };
}

function rawEventId(raw: unknown): string | null {
  const id = (raw as { eventId?: unknown } | null)?.eventId;
  return typeof id === "string" && z.uuid().safeParse(id).success ? id : null;
}

async function handleEvent(tx: Tx, ctx: LearnerCtx, raw: unknown, enrolled: EntitledCourse[]): Promise<EventResult> {
  const parsed = LearningEvent.safeParse(raw);
  if (!parsed.success) return { eventId: rawEventId(raw), status: "rejected", reason: "invalid_format" };
  await tx.$executeRaw`SAVEPOINT sync_event`;
  try {
    const result = await recordEvent(tx, ctx, parsed.data, enrolled);
    await tx.$executeRaw`RELEASE SAVEPOINT sync_event`;
    return result;
  } catch {
    // Lỗi tạm thời của riêng sự kiện này: máy giữ lại và gửi lần sau.
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT sync_event`;
    return { eventId: parsed.data.eventId, status: "retryable" };
  }
}

export async function syncEvents(
  ctx: LearnerCtx,
  input: { events: unknown[]; trustedKids?: string[]; knownCourseIds?: string[] },
): Promise<SyncResult> {
  if (input.events.length > MAX_EVENTS) throw new HttpError(400, `Tối đa ${MAX_EVENTS} sự kiện mỗi lần`);
  const results = await withTx(
    async (tx) => {
      // Hai lô cùng thiết bị chạy lần lượt.
      await tx.$queryRaw`SELECT id FROM devices WHERE id = ${ctx.deviceId}::uuid FOR UPDATE`;
      const enrolled = await entitledCourses(ctx.userId, tx);
      const out: EventResult[] = [];
      for (const raw of input.events) {
        const result = await handleEvent(tx, ctx, raw, enrolled);
        out.push(result);
        if (result.status === "rejected") {
          await tx.$executeRaw`
            INSERT INTO sync_rejections (user_id, device_id, event_id, reason, raw)
            VALUES (${ctx.userId}::uuid, ${ctx.deviceId}::uuid, ${result.eventId}::uuid, ${result.reason!}, ${JSON.stringify(raw ?? null)}::jsonb)`;
        }
      }
      return out;
    },
    { txTimeoutMs: SYNC_TX_TIMEOUT_MS, statementTimeoutMs: 10_000 },
  );
  // Commit rồi mới cấp giấy phép, theo quyền học tại thời điểm này.
  const courses = await entitledCourses(ctx.userId);
  const held = new Set(courses.map((c) => c.courseId));
  return {
    results,
    license: issueLicense({
      userId: ctx.userId, deviceId: ctx.deviceId, trustedKids: input.trustedKids,
      courses: courses.map((c) => ({ id: c.courseId, versionId: c.versionId })),
    }),
    courses: courses.map((c) => ({ id: c.courseId, slug: c.slug, versionId: c.versionId })),
    revokedCourseIds: (input.knownCourseIds ?? []).filter((id) => !held.has(id)),
  };
}
