import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interviewWorkbookToDataset, InterviewWorkbookError, type InterviewLesson } from "@/modules/content/interview-workbook";
import { readSheetRows } from "@/modules/content/xlsx";
import { workbook, type Sheets as InterviewSheets } from "../helpers/interview";

type Sheets = InterviewSheets;

const run = (s: Sheets) => interviewWorkbookToDataset((name) => s[name] ?? null, "xlsx-test");
const problemsOf = (s: Sheets): string[] => {
  try {
    run(s);
  } catch (error) {
    if (error instanceof InterviewWorkbookError) return error.problems;
    throw error;
  }
  return [];
};

describe("interviewWorkbookToDataset", () => {
  it("một khóa nháp, bài theo Thứ tự, chủ đề theo thứ tự xuất hiện, chữ giữ nguyên", () => {
    const d = run(workbook());
    expect(d.publication.importable).toBe(true);
    expect(d.courses).toEqual([{ id: "mea_cadet_interview", title: { vi: "Luyện phỏng vấn Engine Cadet", en: "Engine Cadet Interview Practice" }, lesson_ids: ["EC-001", "EC-002"] }]);
    expect(d.catalog.modules.map((m) => [m.id, m.title.vi, m.lesson_ids])).toEqual([["T01", "Giới thiệu", ["EC-001"]], ["T02", "Động lực", ["EC-002"]]]);
    const [one, two] = d.lessons as InterviewLesson[];
    expect(two!.lesson_type).toBe("interview");
    expect(two!.module_id).toBe("T02");
    expect(two!.question.text).toEqual({ en: "Why did you choose marine engineering?", vi: "Tại sao bạn chọn ngành máy tàu thủy?" });
    expect(two!.question.variants.map((v) => v.id)).toEqual(["EC-002-Q1", "EC-002-Q2"]);
    expect(two!.segments.map((s) => s.id)).toEqual(["EC-002-B1", "EC-002-B2"]);
    expect(two!.advanced.en).toBe("I want to join.\nI am willing to learn.");
    expect(two!.bank.question.en).toBe("1. Why did you choose marine engineering?\n2. Why the engine department?");
    expect(two!.starter.extra).toEqual({ en: "machinery", vi: "máy móc" });
    expect(one!.starter.extra).toBeNull();
    expect(one!.starter.first.en).toBe("My name is {name}.");
    expect(two!.personalization).toBeUndefined();
  });

  it("chỗ trống {name} và [..] gắn với trường hồ sơ; nhãn chỉ có trong đáp án mẫu tiếng Việt thì không", () => {
    const one = run(workbook()).lessons[0] as InterviewLesson;
    expect(one.personalization!.bindings).toEqual(expect.arrayContaining([
      { placeholder: "name", field: "full_name" },
      { placeholder: "tools actually used", field: "tools_used" },
      { placeholder: "ghi các dụng cụ thực tế đã dùng", field: "tools_used" },
    ]));
    expect(one.personalization!.fields.map((f) => f.key).sort()).toEqual(["full_name", "tools_used"]);
    expect((run(workbook()).lessons[1] as InterviewLesson).personalization).toBeUndefined();
  });

  it("cùng đầu vào → cùng dữ liệu (nhập lại không tạo phiên bản)", () => {
    expect(JSON.stringify(run(workbook()))).toBe(JSON.stringify(run(workbook())));
  });

  it("thiếu trang hoặc cột → lỗi rõ", () => {
    const s = workbook();
    delete s["Cách hỏi"];
    expect(problemsOf(s)).toContain('Thiếu trang "Cách hỏi"');
    const t = workbook();
    t["Luyện từng ý"]![1] = ["Mã câu", "Mã đoạn", "Thứ tự", "Đoạn tiếng Anh", "Nghĩa của đoạn"];
    expect(problemsOf(t)).toContain('Trang "Luyện từng ý": thiếu cột "Từ khóa gợi nhớ"');
  });

  it("lỗi theo dòng: mã sai, trùng, thiếu đáp án, thiếu cách hỏi / Tập từ đầu / đoạn, đoạn không khớp, mã lạ", () => {
    const s = workbook();
    s["Ngân hàng"]!.push(["EC-2", "", "X", "3"], [...s["Ngân hàng"]![4]!]);
    s["Ngân hàng"]![3]![8] = "";
    s["Cách hỏi"]!.splice(3, 1);
    s["Tập từ đầu"]!.push([...s["Tập từ đầu"]![2]!]);
    s["Luyện từng ý"]![3]![3] = "Because I love machinery.";
    s["Mẫu nâng cao"]!.push(["EC-099", "x", "y", ""]);
    const p = problemsOf(s);
    expect(p).toContain('Trang "Ngân hàng", dòng 6: mã câu "EC-2" không đúng dạng EC-000');
    expect(p).toContain('Trang "Ngân hàng", dòng 7, EC-001: trùng mã với dòng 5');
    expect(p).toContain('Trang "Ngân hàng", dòng 4, EC-002: thiếu "Đáp án nâng cao (tiếng Anh)"');
    expect(p).toContain('Trang "Ngân hàng", dòng 5, EC-001: chưa có cách hỏi ở trang "Cách hỏi"');
    expect(p).toContain('Trang "Ngân hàng", dòng 5, EC-001: cần đúng một dòng ở trang "Tập từ đầu" (đang có 2)');
    expect(p).toContain('Trang "Ngân hàng", dòng 4, EC-002: các đoạn ở trang "Luyện từng ý" nối lại không đúng bằng đáp án cơ bản (tiếng Anh)');
    expect(p).toContain('Trang "Mẫu nâng cao", dòng 5, EC-099: mã câu không có trong trang "Ngân hàng"');
  });

  it("thiếu đoạn, Thứ tự sai hoặc trùng, mẫu nâng cao khác Ngân hàng", () => {
    const s = workbook();
    s["Luyện từng ý"] = s["Luyện từng ý"]!.filter((r) => r[0] !== "EC-001");
    s["Cách hỏi"]![4]![2] = "1";
    s["Mẫu nâng cao"]![2]![1] = "My name is Hung.";
    s["Ngân hàng"]![3]![3] = "hai";
    const p = problemsOf(s);
    expect(p).toContain('Trang "Ngân hàng", dòng 5, EC-001: chưa có đoạn nào ở trang "Luyện từng ý"');
    expect(p.some((x) => x.includes("EC-002: trùng \"Thứ tự\" 1"))).toBe(true);
    expect(p).toContain('Trang "Mẫu nâng cao", dòng 3, EC-001: đáp án nâng cao khác trang "Ngân hàng"');
    expect(p).toContain('Trang "Ngân hàng", dòng 4, EC-002: "Thứ tự" phải là số nguyên dương');
  });
});

describe("tệp thật của chủ (25/11/2026)", () => {
  const bytes = readFileSync("tests/fixtures/engine-cadet-interview.xlsx");
  const read = (name: string) => {
    try {
      return readSheetRows(bytes, name);
    } catch {
      return null;
    }
  };
  const d = interviewWorkbookToDataset(read, "xlsx-real");
  const lessons = d.lessons as InterviewLesson[];
  const byCode = (c: string) => lessons.find((l) => l.source_display_code === c)!;

  it("87 bài EC-001…EC-092 giữ khoảng trống, 17 chủ đề", () => {
    expect(lessons).toHaveLength(87);
    expect(lessons[0]!.id).toBe("EC-001");
    expect(lessons.at(-1)!.id).toBe("EC-092");
    expect(lessons.map((l) => l.source_display_code)).not.toContain("EC-004");
    expect(d.catalog.modules).toHaveLength(17);
    expect(d.catalog.modules[0]!.title.vi).toBe("Giới thiệu và học vấn");
  });

  it("chữ đúng nguyên văn (EC-028 giữ câu gốc, EC-002 như ví dụ của chủ)", () => {
    const two = byCode("EC-002");
    expect(two.question.text.en).toBe("Why did you choose marine engineering?");
    expect(two.starter.first.en).toBe("I like machinery.");
    expect(two.segments[0]!.text.en).toBe("Because I like machinery and technical work.");
    expect(byCode("EC-028").basic.en).toContain("More quantity then more fuel supply, produce more power.");
    expect(byCode("EC-001").starter.first.en).toBe("My name is {name}.");
    expect(byCode("EC-013").personalization!.bindings).toContainEqual({ placeholder: "subject", field: "favourite_subject" });
    expect(byCode("EC-066").personalization!.bindings).toContainEqual({ placeholder: "describe training or supervised work", field: "training_experience" });
  });
});
