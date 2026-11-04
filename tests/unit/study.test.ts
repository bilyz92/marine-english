import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkExercise } from "@/lib/study/exercise";
import { defaultLevel, groupActivities, levelData, type StudyLesson } from "@/lib/study/levels";
import { personalize } from "@/lib/study/personalize";

// docs/superpowers/plans/2026-11-03-three-level-study.md, bước 2.
const cadet = JSON.parse(readFileSync("docs/Engine_Cadet_Three_Levels_v6/Engine_Cadet_Learning_Data_v6.json", "utf8"));
const lessonOf = (id: string): StudyLesson => {
  const l = cadet.lessons.find((x: { id: string }) => x.id === id);
  return { ...l, exercises: cadet.learning_exercises.filter((e: { lesson_id: string }) => e.lesson_id === id) };
};

describe("điền chỗ trống theo hồ sơ", () => {
  const bindings = [
    { placeholder: "name", field: "full_name" },
    { placeholder: "tên", field: "full_name" },
    { placeholder: "university", field: "university" },
  ];
  it("điền đủ; nhãn Anh và Việt cùng trường", () => {
    const ctx = { bindings, scope: "A001", profile: { full_name: "Nguyễn Văn An", university: "VMU" } };
    expect(personalize("My name is [name]. I study at [university].", ctx)).toEqual({ text: "My name is Nguyễn Văn An. I study at VMU.", missing: [] });
    expect(personalize("Tôi tên là [tên].", ctx).text).toBe("Tôi tên là Nguyễn Văn An.");
  });
  it("thiếu trường: giữ nguyên nhãn, báo trường thiếu (không trùng); nhãn không có binding giữ nguyên, không báo", () => {
    const r = personalize("[name] [name] [university] [actual experience]", { bindings, scope: "A001", profile: { full_name: "  " } });
    expect(r).toEqual({ text: "[name] [name] [university] [actual experience]", missing: ["full_name", "university"] });
  });
  it("có phạm vi: dùng binding của đúng bài, không dùng nhầm bài khác cùng nhãn", () => {
    const scoped = [
      { scope: "OL-A013-PSC", placeholder: "thực tế", field: "detail_psc" },
      { scope: "OL-A025", placeholder: "thực tế", field: "detail_maint" },
    ];
    const profile = { detail_psc: "đã gặp kiểm tra PSC", detail_maint: "đã phụ thay lọc" };
    expect(personalize("[thực tế]", { bindings: scoped, scope: "OL-A025", profile }).text).toBe("đã phụ thay lọc");
    expect(personalize("[thực tế]", { bindings: scoped, scope: "OL-A013-PSC", profile }).text).toBe("đã gặp kiểm tra PSC");
    // Câu phụ liên kết từ bài khác: chỉ một binding có phạm vi cho nhãn đó thì dùng nó.
    expect(personalize("[only here]", { bindings: [{ scope: "OL-A010", placeholder: "only here", field: "x" }], scope: "OL-A010-SMS", profile: { x: "OK" } }).text).toBe("OK");
  });
});

describe("điền chỗ trống: song ngữ, dữ liệu hỏng", () => {
  const bindings = [{ placeholder: "actual school", field: "school" }, { placeholder: "trường thật", field: "school" }];
  it("trường song ngữ: chữ tiếng Anh dùng giá trị tiếng Anh, chữ tiếng Việt dùng giá trị tiếng Việt", () => {
    const profile = { "school.en": "Vietnam Maritime University", "school.vi": "Đại học Hàng hải Việt Nam" };
    expect(personalize("I studied at [actual school].", { bindings, scope: "x", profile, lang: "en" }).text).toBe("I studied at Vietnam Maritime University.");
    expect(personalize("Tôi học ở [trường thật].", { bindings, scope: "x", profile, lang: "vi" }).text).toBe("Tôi học ở Đại học Hàng hải Việt Nam.");
  });
  it("thiếu bản tiếng Anh thì báo thiếu, không lấy bản tiếng Việt chèn vào câu tiếng Anh", () => {
    const r = personalize("[actual school]", { bindings, scope: "x", profile: { "school.vi": "ĐH Hàng hải" }, lang: "en" });
    expect(r).toEqual({ text: "[actual school]", missing: ["school"] });
  });
  it("giá trị lưu hỏng (không phải chữ) không làm sập, coi như thiếu", () => {
    const r = personalize("[actual school]", { bindings, scope: "x", profile: { school: 42 } as never, lang: "en" });
    expect(r.missing).toEqual(["school"]);
  });
});

describe("bài tập", () => {
  const gap = { id: "e1", type: "context_gap", prompt: { en: "My ____ is [name]." }, answer: { en: "name", vi: "tên" }, feedback: { en: "Use name.", vi: "Dùng name." } };
  it("điền từ: không phân biệt hoa thường, khoảng trắng, dấu câu cuối", () => {
    expect(checkExercise(gap, "  Name. ")).toEqual({ correct: true, feedback: { en: "Use name.", vi: "Dùng name." } });
    expect(checkExercise(gap, "age").correct).toBe(false);
    expect(checkExercise(gap, "").correct).toBe(false);
  });
  it("trắc nghiệm: so mã phương án", () => {
    const sc = { id: "e2", type: "single_choice", options: [{ id: "A" }, { id: "B" }], answer_option_id: "B", feedback: { vi: "Đúng là B." } };
    expect(checkExercise(sc, "B").correct).toBe(true);
    expect(checkExercise(sc, "A").correct).toBe(false);
  });
});

describe("dữ liệu theo mức", () => {
  it("A001: Mức 1 có 3 bước và 3 bài điền từ; Mức 2 có 3 ý và bài trắc nghiệm; Mức 3 có câu phụ và cách hỏi khác", () => {
    const l = lessonOf("A001");
    const f = levelData(l, "foundation");
    expect(f.steps.map((s) => s.id)).toEqual(["A001.micro.1", "A001.micro.2", "A001.micro.3"]);
    expect(f.exercises.map((e) => e.type)).toEqual(["context_gap", "context_gap", "context_gap"]);
    const d = levelData(l, "developing");
    expect(d.keyPoints).toHaveLength(3);
    expect(d.exercises.map((e) => e.type)).toContain("single_choice");
    const i = levelData(l, "independent");
    expect(i.variants.length).toBeGreaterThan(0);
    expect(i.followUps.length).toBeGreaterThan(0);
  });
  it("A046 đủ 7 bước ở Mức 1", () => {
    expect(levelData(lessonOf("A046"), "foundation").steps).toHaveLength(7);
  });
  it("mức mặc định: mức đã lưu của bài, rồi mức ưu tiên của tài khoản, cuối cùng Mức 1; giá trị lạ bị bỏ", () => {
    expect(defaultLevel({ lesson: "independent", account: "developing" })).toBe("independent");
    expect(defaultLevel({ lesson: null, account: "developing" })).toBe("developing");
    expect(defaultLevel({ lesson: "xyz", account: null })).toBe("foundation");
  });
});

describe("lưu trên máy", () => {
  it("đăng xuất xóa hồ sơ và bài làm của đúng học viên đó; khách chỉ lưu trong phiên", async () => {
    const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() } as Storage; };
    const g = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
    g.localStorage = mem();
    g.sessionStorage = mem();
    const s = await import("@/lib/study/storage");
    s.saveProfile("u1", { full_name: "An" });
    s.saveLessonState("u1", "A001", { level: "developing" });
    s.saveProfile("u2", { full_name: "Bình" });
    s.saveProfile(s.GUEST, { full_name: "Khách" });
    expect(g.localStorage.getItem(`me.profile.${s.GUEST}`)).toBeNull();
    expect(s.loadProfile(s.GUEST)).toEqual({ full_name: "Khách" });
    s.clearStudyData("u1");
    expect(s.loadProfile("u1")).toEqual({});
    expect(s.loadLessonState("u1", "A001")).toEqual({});
    expect(s.loadProfile("u2")).toEqual({ full_name: "Bình" });
  });
});

describe("đáp án thay thế theo hồ sơ", async () => {
  const { pickAlternative } = await import("@/lib/study/alternatives");
  const base = { en: "I study at [university]." };
  const alts = [
    { when_vi: "Nếu đã tốt nghiệp", condition: { profile_field: "education_status", equals: "graduated" }, text: { en: "I graduated from [university]." } },
    { when_vi: "Nếu chưa thực hành", condition: { selection: "learner_confirms_no_practice" }, text: { en: "I have not practised yet." } },
    { when_vi: "Nếu đã tốt nghiệp và đã đi biển", condition: { all: [{ profile_field: "education_status", equals: "graduated" }, { profile_field: "sea_service_status", equals: "has_sea_service" }] }, text: { en: "Both." } },
  ];
  it("trường hồ sơ khớp → dùng câu đó; câu cần tự xác nhận vẫn để chọn", () => {
    const r = pickAlternative(base, alts, { education_status: "graduated" });
    expect(r.text).toEqual({ en: "I graduated from [university]." });
    // Câu kép còn phụ thuộc "đã đi biển" chưa điền: vẫn liệt kê để học viên đối chiếu.
    expect(r.choices.map((c) => c.when_vi)).toEqual(["Nếu chưa thực hành", "Nếu đã tốt nghiệp và đã đi biển"]);
  });
  it("điều kiện 'all' đủ cả hai → dùng câu đó", () => {
    expect(pickAlternative(base, alts, { education_status: "graduated", sea_service_status: "has_sea_service" }).text).toEqual({ en: "Both." });
  });
  it("trường chưa điền → câu gốc, liệt kê câu theo điều kiện để học viên biết; không tự suy ra", () => {
    const r = pickAlternative(base, alts, {});
    expect(r.text).toEqual(base);
    expect(r.choices.map((c) => c.when_vi)).toEqual(["Nếu đã tốt nghiệp", "Nếu chưa thực hành", "Nếu đã tốt nghiệp và đã đi biển"]);
    expect(r.unsetFields).toEqual(["education_status", "sea_service_status"]);
  });
  it("điều kiện ghép đã sai một phần → không hỏi trường còn thiếu của nó", () => {
    const r = pickAlternative(base, [alts[2]!], { education_status: "studying" });
    expect(r.unsetFields).toEqual([]);
    expect(r.choices).toEqual([]);
  });
  it("trường đã điền mà không khớp → câu gốc, không liệt kê câu sai điều kiện", () => {
    const r = pickAlternative(base, alts, { education_status: "studying", sea_service_status: "none" });
    expect(r.text).toEqual(base);
    expect(r.choices.map((c) => c.when_vi)).toEqual(["Nếu chưa thực hành"]);
  });
});

describe("trường còn thiếu theo phần đang hiện", async () => {
  const { missingFor } = await import("@/lib/study/levels");
  const l = {
    ...lessonOf("A001"),
    personalization: {
      bindings: [{ placeholder: "name", field: "full_name" }, { placeholder: "university", field: "university" }, { placeholder: "actual workshop or onboard experience", field: "training_experience" }],
      fields: [{ key: "full_name", label: { vi: "Họ và tên" } }, { key: "university", label: { vi: "Trường" } }, { key: "training_experience", label: { vi: "Thực hành" } }, { key: "education_status", label: { vi: "Tình trạng học tập" }, type: "enum", values: ["studying", "graduated"] }],
    },
  };
  it("Mức 1 bước 1 (What is your name?) chỉ cần họ tên; bước 2 cần trường và tình trạng học (đáp án thay thế)", () => {
    expect(missingFor(l, "foundation", 0, {}).map((f) => f.key)).toEqual(["full_name"]);
    expect(missingFor(l, "foundation", 1, {}).map((f) => f.key).sort()).toEqual(["education_status", "university"]);
  });
  it("Mức 2 cần các trường của câu trả lời mẫu", () => {
    expect(missingFor(l, "developing", 0, {}).map((f) => f.key)).toEqual(expect.arrayContaining(["full_name", "university", "training_experience"]));
  });
});

describe("danh sách hoạt động (chủ chọn 04/11/2026)", () => {
  it("mục cùng loại chỉ hiện một lần, giữ thứ tự, gom đủ id để bấm một lần là xong cả nhóm", () => {
    const groups = groupActivities([
      { id: "a3", type: "listen", order: 3 }, { id: "a1", type: "listen", order: 1 },
      { id: "a2", type: "speak", order: 2 }, { id: "a4", type: "speak", order: 4 },
    ]);
    expect(groups).toEqual([{ type: "listen", ids: ["a1", "a3"] }, { type: "speak", ids: ["a2", "a4"] }]);
  });
  it("không có hoạt động → rỗng", () => {
    expect(groupActivities(undefined)).toEqual([]);
  });
});
