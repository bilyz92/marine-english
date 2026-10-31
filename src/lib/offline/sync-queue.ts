// Hàng chờ sự kiện học trên máy (hàm thuần). Máy chỉ xóa sự kiện sau khi máy chủ xác nhận.

export type EventType = "lesson_opened" | "activity_completed" | "lesson_completed" | "quiz_attempt";
export type QueuedEvent = {
  eventId: string;
  seq: number;
  type: EventType;
  lessonVersionId: string;
  payload: Record<string, unknown>;
  clientTime: string;
};
export type EventResult = { eventId: string | null; status: "accepted" | "duplicate" | "rejected" | "retryable"; reason?: string };

export const MAX_BATCH = 200;

const bySeq = (a: QueuedEvent, b: QueuedEvent) => a.seq - b.seq;

export function buildEvent(input: {
  lastSeq: number;
  type: EventType;
  lessonVersionId: string;
  payload?: Record<string, unknown>;
  now?: Date;
}): QueuedEvent {
  return {
    eventId: crypto.randomUUID(),
    seq: input.lastSeq + 1,
    type: input.type,
    lessonVersionId: input.lessonVersionId,
    payload: input.payload ?? {},
    clientTime: (input.now ?? new Date()).toISOString(),
  };
}

export function nextBatch(queue: QueuedEvent[]): QueuedEvent[] {
  return [...queue].sort(bySeq).slice(0, MAX_BATCH);
}

/** Xóa accepted/duplicate; rejected chuyển sang kho cách ly (không gửi lại); retryable và sự kiện chưa có kết quả được giữ. */
export function applySyncResults(
  queue: QueuedEvent[],
  results: EventResult[],
): { keep: QueuedEvent[]; quarantine: { event: QueuedEvent; reason: string }[] } {
  const byId = new Map(results.map((r) => [r.eventId, r]));
  const keep: QueuedEvent[] = [];
  const quarantine: { event: QueuedEvent; reason: string }[] = [];
  for (const event of [...queue].sort(bySeq)) {
    const result = byId.get(event.eventId);
    if (result?.status === "rejected") quarantine.push({ event, reason: result.reason ?? "rejected" });
    else if (result?.status !== "accepted" && result?.status !== "duplicate") keep.push(event);
  }
  return { keep, quarantine };
}
