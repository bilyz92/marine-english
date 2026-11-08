import { describe, expect, it } from "vitest";
import { groupByModule, groupByTopic } from "@/lib/offline/topics";

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

// Module → Chủ đề → Bài (docs/superpowers/plans/2026-11-08-course-modules.md, Task 3).
describe("chia bài theo module", () => {
  const ml = (externalId: string, moduleId: string | null, topic: string | null, status: "completed" | "in_progress" | null = null) => ({ externalId, moduleId, topic, status });
  const MODULES = [{ id: "m1", titleVi: "Kinh nghiệm phỏng vấn" }, { id: "m2", titleVi: "Kinh nghiệm vận hành sửa chữa" }];
  const TOPICS = [{ id: "A1", titleVi: "Học vấn" }, { id: "A4", titleVi: "Động cơ diesel" }];

  it("hai module, chủ đề bên trong mỗi module; đếm xong/tổng", () => {
    const groups = groupByModule(MODULES, TOPICS, [ml("A001", "m1", "A1", "completed"), ml("A002", "m1", "A1"), ml("A022", "m2", "A4"), ml("E1", "m2", null)])!;
    expect(groups.map((g) => [g.id, g.titleVi, g.done, g.total])).toEqual([["m1", "Kinh nghiệm phỏng vấn", 1, 2], ["m2", "Kinh nghiệm vận hành sửa chữa", 0, 2]]);
    expect(groups[0]!.topics!.map((t) => [t.id, t.lessons.length])).toEqual([["A1", 2]]);
    expect(groups[1]!.topics!.map((t) => [t.id, t.lessons.length])).toEqual([["A4", 1], [null, 1]]);
  });

  it("bài chưa xếp module → nhóm Bài khác ở cuối; module không có bài vẫn bỏ", () => {
    const groups = groupByModule(MODULES, TOPICS, [ml("A001", "m1", "A1"), ml("X1", null, null)])!;
    expect(groups.map((g) => [g.id, g.titleVi])).toEqual([["m1", "Kinh nghiệm phỏng vấn"], [null, "Bài khác"]]);
  });

  it("manifest cũ (chưa có modules) hoặc khóa chưa chia module → null", () => {
    expect(groupByModule(undefined, TOPICS, [ml("A001", null, "A1")])).toBeNull();
    expect(groupByModule([], TOPICS, [ml("A001", null, "A1")])).toBeNull();
  });

  it("mở sẵn module có bài đang học; không có thì module đầu còn bài chưa xong", () => {
    expect(groupByModule(MODULES, TOPICS, [ml("A001", "m1", "A1", "completed"), ml("A022", "m2", "A4", "in_progress")])!.map((g) => g.open)).toEqual([false, true]);
    expect(groupByModule(MODULES, TOPICS, [ml("A001", "m1", "A1", "completed"), ml("A022", "m2", "A4")])!.map((g) => g.open)).toEqual([false, true]);
  });

  it("module không có chủ đề nào (bài web) → topics null, hiện bài phẳng", () => {
    const groups = groupByModule(MODULES, TOPICS, [ml("E1", "m2", null), ml("E2", "m2", null)])!;
    expect(groups[0]!.topics).toBeNull();
    expect(groups[0]!.lessons.map((l) => l.externalId)).toEqual(["E1", "E2"]);
  });
});
