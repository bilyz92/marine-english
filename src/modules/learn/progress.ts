import type { Tx } from "@/lib/db";

export type ProgressChange = { status: "in_progress" | "completed"; activityId?: string; scorePct?: number };

/** Cập nhật tiến độ theo quy tắc chỉ tăng: trạng thái không lùi, điểm lấy cao nhất, hoạt động đã xong chỉ thêm. */
export async function bumpProgress(tx: Tx, userId: string, lessonId: string, change: ProgressChange): Promise<void> {
  const activities = change.activityId ? [change.activityId] : [];
  await tx.$executeRaw`
    INSERT INTO learning_progress (user_id, lesson_id, status, completed_activities, best_score_pct)
    VALUES (${userId}::uuid, ${lessonId}::uuid, ${change.status}, ${activities}::text[], ${change.scorePct ?? null}::int)
    ON CONFLICT (user_id, lesson_id) DO UPDATE SET
      status = CASE WHEN learning_progress.status = 'completed' OR EXCLUDED.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
      completed_activities = ARRAY(SELECT DISTINCT unnest(learning_progress.completed_activities || EXCLUDED.completed_activities) ORDER BY 1),
      best_score_pct = GREATEST(learning_progress.best_score_pct, EXCLUDED.best_score_pct),
      updated_at = now()`;
}
