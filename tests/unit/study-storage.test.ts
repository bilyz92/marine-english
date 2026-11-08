import { beforeEach, describe, expect, it } from "vitest";
import { loadLessonState, saveLessonState, updateLessonState } from "@/lib/study/storage";

// Nháp bài tự luận ghép vào trạng thái bài, không xóa mức/bước/bài tập đã lưu (2026-11-08-course-modules, Task 2).

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
});

describe("lưu nháp tự luận", () => {
  it("updateLessonState giữ level, step, exercises khi ghi drafts.essay", () => {
    saveLessonState("hv1", "A022", { level: "developing", step: 2, exercises: { e1: { value: "x", checked: true } } });
    updateLessonState("hv1", "A022", { drafts: { ...loadLessonState("hv1", "A022").drafts, essay: "First, I check..." } });
    expect(loadLessonState("hv1", "A022")).toEqual({
      level: "developing", step: 2, exercises: { e1: { value: "x", checked: true } }, drafts: { essay: "First, I check..." },
    });
  });

  it("nháp của người này không hiện cho người khác cùng máy", () => {
    updateLessonState("hv1", "A022", { drafts: { essay: "Bài của A" } });
    expect(loadLessonState("hv2", "A022")).toEqual({});
  });
});
