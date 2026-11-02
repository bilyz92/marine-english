import { describe, expect, it } from "vitest";
import { applyFields } from "@/modules/content/editor";

// Bỏ ý chính hoặc câu phụ trên web: mọi tham chiếu tới mã đã bỏ đều được dọn, kể cả trong đáp án mẫu dựng lại.
const base = {
  id: "L1",
  key_points: [{ id: "L1.kp.1", text: { en: "one" } }, { id: "L1.kp.2", text: { en: "two" } }],
  follow_up_questions: [{ id: "L1.probe.1", prompt: { en: "Why?" } }],
  model_answer: { id: "L1.answer", text: { en: "Answer" }, covers_key_point_ids: ["L1.kp.1", "L1.kp.2"], main_point_ref: "L1.kp.1" },
  coaching: { focus_point: "L1.kp.1", note: "giữ" },
  extras: [{ id: "L1.kp.1", note: "bản sao theo mã" }, { id: "khac" }],
  recall_cards: [{ id: "c1", key_point_id: "L1.kp.1" }, { id: "c2", key_point_id: "L1.kp.2" }],
};
const fields = {
  questionEn: "Q?", questionVi: "", vocabulary: [], modelAnswerEn: "Answer", modelAnswerVi: "",
  keyPoints: [{ id: "L1.kp.2", en: "two", vi: "" }], followUps: [],
};

describe("dọn tham chiếu khi bỏ mục", () => {
  it("bỏ mã ở mảng, ở trường đơn, mục có id trùng mã đã bỏ, và cả trong đáp án mẫu", () => {
    const out = applyFields(base, "L1", fields) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toContain('"L1.kp.1"');
    expect(json).not.toContain('"L1.probe.1"');
    expect(out.model_answer).toMatchObject({ covers_key_point_ids: ["L1.kp.2"] });
    expect(out.coaching).toEqual({ note: "giữ" });
    expect(out.extras).toEqual([{ id: "khac" }]);
    expect(out.recall_cards).toEqual([{ id: "c2", key_point_id: "L1.kp.2" }]);
  });
});
