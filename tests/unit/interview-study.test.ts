import { describe, expect, it } from "vitest";
import {
  correctFirst, enterLesson, fillSlots, hiddenMark, markSpoken, recordingKey, speechText, spokenFrom, targetReached, variantIndex,
} from "@/lib/study/interview";

// Bài luyện phỏng vấn (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 4).

const personalization = {
  bindings: [{ placeholder: "name", field: "full_name" }, { placeholder: "training", field: "actual_training" }, { placeholder: "quá trình học tập/huấn luyện", field: "actual_training" }],
  fields: [{ key: "full_name", label: { vi: "Họ và tên" }, type: "string" }, { key: "actual_training", label: { vi: "Đợt huấn luyện thực tế" }, type: "localized_text" }],
};

describe("cách hỏi và lựa chọn", () => {
  it("lượt vào bài xoay vòng cách hỏi; nút Cách hỏi khác dịch trong lượt", () => {
    expect([1, 2, 3, 4].map((v) => variantIndex(3, v))).toEqual([0, 1, 2, 0]);
    expect(variantIndex(2, 1, 1)).toBe(1);
    expect(variantIndex(1, 5, 3)).toBe(0);
    expect(variantIndex(0, 3)).toBe(0);
  });

  it("thứ tự hai lựa chọn ổn định trong một lượt, có lượt đổi", () => {
    expect(correctFirst("EC-002", 1)).toBe(correctFirst("EC-002", 1));
    const seen = new Set([1, 2, 3, 4, 5, 6].map((v) => correctFirst("EC-002", v)));
    expect(seen.size).toBe(2);
  });
});

describe("chỗ trống và chữ đọc", () => {
  it("điền {name} bằng hồ sơ; chưa điền → giữ chỗ trống để hiện nhãn, giọng đọc bỏ qua, báo trường thiếu", () => {
    const empty = fillSlots("My name is {name}.", { personalization, profile: {}, lang: "en" });
    expect(empty.missing.map((f) => f.key)).toEqual(["full_name"]);
    expect(spokenFrom(empty.parts)).toEqual({ text: "My name is.", skipped: true });
    const filled = fillSlots("My name is {name}.", { personalization, profile: { full_name: "Nam" }, lang: "en" });
    expect(filled.missing).toEqual([]);
    expect(spokenFrom(filled.parts)).toEqual({ text: "My name is Nam.", skipped: false });
  });

  it("trường song ngữ: câu tiếng Anh chỉ nhận giá trị tiếng Anh", () => {
    const profile = { "actual_training.vi": "Thực tập xưởng" };
    expect(fillSlots("During [training].", { personalization, profile, lang: "en" }).missing.map((f) => f.key)).toEqual(["actual_training"]);
    const vi = fillSlots("Trong [quá trình học tập/huấn luyện].", { personalization, profile, lang: "vi" });
    expect(vi.parts).toContainEqual(expect.objectContaining({ kind: "slot", value: "Thực tập xưởng" }));
  });

  it("chỗ trống không có trường hồ sơ: không điền được, không đọc thành tiếng", () => {
    const r = fillSlots("I like [lý do] a lot.", { profile: {}, lang: "vi" });
    expect(r.missing).toEqual([]);
    expect(spokenFrom(r.parts).text).toBe("I like a lot.");
  });

  it("DATA03: bỏ số thứ tự, xuống dòng thành câu, ký hiệu đọc theo nghĩa; chữ gốc không đổi", () => {
    const raw = "1. Please introduce yourself?\n2. Tell me about yourself";
    expect(speechText(raw)).toBe("Please introduce yourself? Tell me about yourself.");
    expect(raw).toBe("1. Please introduce yourself?\n2. Tell me about yourself");
    expect(speechText("Evaporator → compressor → condenser.")).toBe("Evaporator, then compressor, then condenser.");
    expect(speechText("Oxygen should be 20.9% and oil below 15 ppm; CO₂ and ME-C, OWS.")).toBe("Oxygen should be 20.9 percent and oil below 15 p p m; C O 2 and M E C, O W S.");
    expect(speechText("Annex I: oil; II: noxious liquid substances; VI: air pollution.")).toBe("Annex One: oil; Annex Two: noxious liquid substances; Annex Six: air pollution.");
    expect(speechText("I: think.")).toBe("I: think.");
    expect(speechText("{name}")).toBe("");
  });
});

describe("bản thu và tiến độ", () => {
  const keys = (spoken: { first: string; basic: string; advanced: string }) => ({
    first: recordingKey("EC-001", { level: "L1", id: "first" }, spoken.first),
    basic: recordingKey("EC-001", { level: "L2", id: "basic" }, spoken.basic),
    advanced: recordingKey("EC-001", { level: "L3", id: "advanced" }, spoken.advanced),
  });

  it("khóa bản thu đổi khi chữ đọc đổi (sửa hồ sơ, nhập lại chữ khác)", () => {
    const a = recordingKey("EC-001", { level: "L1", id: "first" }, "My name is.");
    expect(a).toMatch(/^EC-001\|L1\|first\|[0-9a-f]{12}$/);
    expect(recordingKey("EC-001", { level: "L1", id: "first" }, "My name is Nam.")).not.toBe(a);
    expect(recordingKey("EC-001", { level: "L1", id: "first" }, "My name is.")).toBe(a);
  });

  it("L1 cần hiểu câu hỏi + thu câu đầu khi đã ẩn tiếng Anh; L2 cả bài cơ bản; L3 bài nâng cao", () => {
    const k = keys({ first: "My name is.", basic: "Basic.", advanced: "Advanced." });
    let p = markSpoken({}, k.first, false);
    expect(targetReached(p, "L1", k)).toBe(false);
    p = { ...markSpoken(p, k.first, true), L1: { understood: false } };
    expect(targetReached(p, "L1", k)).toBe(false);
    p = { ...p, L1: { understood: true } };
    expect(targetReached(p, "L1", k)).toBe(true);
    expect(p.spoken).toContain(hiddenMark(k.first));
    expect(targetReached(p, "L2", k)).toBe(false);
    expect(targetReached(markSpoken(p, k.basic, false), "L2", k)).toBe(true);
    expect(targetReached(markSpoken(p, k.advanced, false), "L3", k)).toBe(true);
  });

  it("đổi hồ sơ → đích về chưa nói (khóa mới), đã xong giữ nguyên", () => {
    const before = keys({ first: "My name is.", basic: "B.", advanced: "A." });
    const p = { ...markSpoken({}, before.first, true), L1: { understood: true }, completed: true };
    const after = keys({ first: "My name is Nam.", basic: "B.", advanced: "A." });
    expect(targetReached(p, "L1", after)).toBe(false);
    expect(p.completed).toBe(true);
  });

  it("mở bài tăng lượt; nội dung đổi → giữ lượt, mức, đã xong; đặt lại bước, đoạn, đã nói", () => {
    const first = enterLesson({}, "h1");
    expect(first).toEqual({ contentHash: "h1", visits: 1 });
    const saved = { ...first, level: "L2" as const, spoken: ["k"], L1: { step: 3 }, L2: { segment: 2 }, completed: true };
    expect(enterLesson(saved, "h1")).toMatchObject({ visits: 2, spoken: ["k"], L2: { segment: 2 } });
    expect(enterLesson(saved, "h2")).toEqual({ contentHash: "h2", visits: 2, level: "L2", completed: true });
  });
});
