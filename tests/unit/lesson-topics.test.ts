import { describe, expect, it } from "vitest";
import { groupByTopic } from "@/lib/offline/topics";

// Giao diện v2: danh sách bài chia theo chủ đề (A1…B1), gập mở được; chủ đề đang học mở sẵn.

const lesson = (externalId: string, topic: string | null, status: "completed" | "in_progress" | null = null) => ({ externalId, topic, status });

describe("chia bài theo chủ đề", () => {
  it("giữ thứ tự chủ đề, đếm bài đã xong, mở chủ đề có bài đang học", () => {
    const groups = groupByTopic(
      [{ id: "A1", titleVi: "Học vấn" }, { id: "A2", titleVi: "Trực ca" }],
      [lesson("A001", "A1", "completed"), lesson("A002", "A1", "completed"), lesson("A011", "A2", "in_progress"), lesson("A012", "A2")],
    )!;
    expect(groups.map((g) => [g.id, g.titleVi, g.lessons.map((l) => l.externalId), g.done, g.open])).toEqual([
      ["A1", "Học vấn", ["A001", "A002"], 2, false],
      ["A2", "Trực ca", ["A011", "A012"], 0, true],
    ]);
  });

  it("chưa học bài nào: mở chủ đề đầu", () => {
    const groups = groupByTopic([{ id: "A1", titleVi: "Học vấn" }, { id: "A2", titleVi: "Trực ca" }], [lesson("A001", "A1"), lesson("A011", "A2")])!;
    expect(groups.map((g) => g.open)).toEqual([true, false]);
  });

  it("học xong cả chủ đề đầu: mở chủ đề có bài chưa xong đầu tiên", () => {
    const groups = groupByTopic([{ id: "A1", titleVi: "Học vấn" }, { id: "A2", titleVi: "Trực ca" }], [lesson("A001", "A1", "completed"), lesson("A011", "A2")])!;
    expect(groups.map((g) => g.open)).toEqual([false, true]);
  });

  it("bài không thuộc chủ đề nào xếp vào nhóm Bài khác ở cuối; chủ đề không có bài thì bỏ", () => {
    const groups = groupByTopic([{ id: "A1", titleVi: "Học vấn" }, { id: "Z9", titleVi: "Trống" }], [lesson("A001", "A1", "completed"), lesson("W1", null)])!;
    expect(groups.map((g) => [g.id, g.titleVi, g.lessons.length])).toEqual([["A1", "Học vấn", 1], [null, "Bài khác", 1]]);
  });

  it("khóa không có chủ đề (bản cũ đã lưu trên máy, bộ câu hỏi Word): trả null để hiện danh sách phẳng", () => {
    expect(groupByTopic(undefined, [lesson("A001", null)])).toBeNull();
    expect(groupByTopic([], [lesson("A001", null)])).toBeNull();
  });
});
