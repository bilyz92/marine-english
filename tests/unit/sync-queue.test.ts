import { describe, expect, it } from "vitest";
import { applySyncResults, buildEvent, nextBatch, type QueuedEvent } from "@/lib/offline/sync-queue";

const e = (eventId: string, seq: number): QueuedEvent => ({ eventId, seq, type: "lesson_opened", lessonVersionId: "lv", payload: {}, clientTime: "2026-10-31T00:00:00.000Z" });

describe("hàng chờ đồng bộ", () => {
  it("xóa accepted/duplicate, cách ly rejected, giữ retryable", () => {
    const queue = [e("a", 1), e("b", 2), e("c", 3), e("d", 4)];
    const out = applySyncResults(queue, [
      { eventId: "a", status: "accepted" },
      { eventId: "b", status: "duplicate" },
      { eventId: "c", status: "rejected", reason: "seq_conflict" },
      { eventId: "d", status: "retryable" },
    ]);
    expect(out.keep.map((x) => x.eventId)).toEqual(["d"]);
    expect(out.quarantine).toEqual([{ event: e("c", 3), reason: "seq_conflict" }]);
  });

  it("sự kiện không có kết quả (máy chủ chưa xử lý) được giữ lại, theo thứ tự seq", () => {
    const out = applySyncResults([e("b", 2), e("a", 1)], [{ eventId: "z", status: "accepted" }]);
    expect(out.keep.map((x) => x.seq)).toEqual([1, 2]);
    expect(out.quarantine).toEqual([]);
  });

  it("lỗi cả request (không có kết quả nào) → giữ nguyên hàng chờ", () => {
    const queue = [e("a", 1)];
    expect(applySyncResults(queue, [])).toEqual({ keep: queue, quarantine: [] });
  });

  it("nextBatch lấy tối đa 200 sự kiện cũ nhất; buildEvent tăng seq, sinh UUID", () => {
    const many = Array.from({ length: 250 }, (_, i) => e(`e${250 - i}`, 250 - i));
    const batch = nextBatch(many);
    expect(batch).toHaveLength(200);
    expect(batch[0]!.seq).toBe(1);
    const built = buildEvent({ lastSeq: 7, type: "quiz_attempt", lessonVersionId: "lv", payload: { scorePct: 80 }, now: new Date("2026-10-31T00:00:00Z") });
    expect(built).toMatchObject({ seq: 8, type: "quiz_attempt", clientTime: "2026-10-31T00:00:00.000Z" });
    expect(built.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
