import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http";
import { HEADERS, parseLessonSheet } from "@/modules/content/excel-import";
import { readSheetRows } from "@/modules/content/xlsx";
import { makeXlsx } from "../helpers/xlsx";

// Khung bài giảng Excel (docs/superpowers/plans/2026-11-08-course-modules.md, Task 8).

const TEMPLATE = readFileSync("src/assets/khung-bai-giang-mau.xlsx");
const row = (over: Partial<Record<number, string>> = {}) => {
  const base = ["Module 2", "", "", "Hỏi–đáp", "What is a purifier?", "", "", "", "", "", ""];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v!;
  return base;
};
const sheet = (...rows: string[][]) => parseLessonSheet([HEADERS, ...rows]);

describe("đọc khung bài giảng Excel", () => {
  it("đọc khung mẫu ra 2 bài mẫu đúng loại, ý chính tách theo dòng và dấu |", () => {
    const { lessons, errors } = parseLessonSheet(readSheetRows(TEMPLATE, "Bài học"));
    expect(errors).toEqual([]);
    expect(lessons.map((l) => [l.row, l.module, l.lessonType, l.topicId])).toEqual([
      [2, "Kinh nghiệm phỏng vấn", "qa", "A1"],
      [3, "Kinh nghiệm vận hành sửa chữa", "essay", "A4"],
    ]);
    expect(lessons[0]!.questionEn).toMatch(/^Please introduce yourself/);
    expect(lessons[0]!.keyPoints[0]).toEqual({ en: "Give your actual name and education", vi: "Nêu tên và quá trình học thực tế" });
    expect(lessons[0]!.keyPoints).toHaveLength(3);
    expect(lessons[0]!.followUps).toHaveLength(1);
    expect(lessons[1]!.modelAnswerEn).toMatch(/^A marine diesel engine converts fuel energy/);
    expect(lessons[1]!.followUps).toEqual([]);
  });

  it("tệp đã mở và lưu lại bằng LibreOffice (chuỗi chia sẻ) đọc ra như khung gốc", () => {
    const saved = readFileSync("tests/fixtures/khung-libreoffice.xlsx");
    expect(readSheetRows(saved, "Bài học")).toEqual(readSheetRows(TEMPLATE, "Bài học"));
  });

  it("tiêu đề cột sai → lỗi dòng 1", () => {
    const { lessons, errors } = parseLessonSheet([["Module", "Câu hỏi"], row()]);
    expect(lessons).toEqual([]);
    expect(errors).toEqual([{ row: 1, message: expect.stringMatching(/^Không đúng khung mẫu/) }]);
  });

  it("tự luận thiếu đáp án → lỗi đúng số dòng", () => {
    const { errors } = sheet(row(), [], row({ 3: "Tự luận" }));
    expect(errors).toEqual([{ row: 4, message: "Bài tự luận cần đáp án mẫu tiếng Anh." }]);
  });

  it("loại Video → lỗi chưa hỗ trợ; thiếu module, thiếu câu hỏi → lỗi", () => {
    const { errors } = sheet(row({ 3: "Video" }), row({ 0: "" }), row({ 4: " " }));
    expect(errors).toEqual([
      { row: 2, message: "Loại bài chưa hỗ trợ: “Video” (chỉ nhận Hỏi–đáp hoặc Tự luận)." },
      { row: 3, message: "Thiếu tên module." },
      { row: 4, message: "Thiếu câu hỏi / đề bài tiếng Anh." },
    ]);
  });

  it("cùng mã chủ đề hai tên khác nhau → lỗi", () => {
    const { errors } = sheet(row({ 1: "C1", 2: "Bơm" }), row({ 1: "C1", 2: "Bơm" }), row({ 1: "C1", 2: "Nồi hơi" }));
    expect(errors).toEqual([{ row: 4, message: "Mã chủ đề C1 đã dùng với tên “Bơm” ở dòng 2." }]);
  });

  it("có tên chủ đề không có mã, hoặc mã sai dạng → lỗi", () => {
    const { errors } = sheet(row({ 2: "Bơm" }), row({ 1: "c-1", 2: "Bơm" }));
    expect(errors).toEqual([
      { row: 2, message: "Có tên chủ đề nhưng thiếu mã chủ đề." },
      { row: 3, message: "Mã chủ đề “c-1” phải là chữ hoa và số, ví dụ A1, B12." },
    ]);
  });

  it("chữ trong ý chính, từ vựng, câu hỏi phụ tối đa 4000 ký tự; lỗi không chép lại cả ô", () => {
    const long = "x".repeat(4001);
    const { errors } = sheet(row({ 6: `${long} | ý` }), row({ 7: `word | ${long}` }));
    expect(errors).toEqual([
      { row: 2, message: "Ý chính: mỗi mục tối đa 4000 ký tự." },
      { row: 3, message: "Từ vựng: mỗi mục tối đa 4000 ký tự." },
    ]);
    const missing = sheet(row({ 6: `| ${"y".repeat(500)}` })).errors[0]!.message;
    expect(missing.length).toBeLessThan(120);
  });

  it("dòng trống bị bỏ; quá 300 bài → lỗi", () => {
    expect(sheet([], ["", " "], row()).lessons).toHaveLength(1);
    const many = parseLessonSheet([HEADERS, ...Array.from({ length: 301 }, () => row())]);
    expect(many.errors).toEqual([{ row: 1, message: "Tối đa 300 bài mỗi tệp." }]);
  });

  it("thiếu trang “Bài học” → 400", () => {
    const err = (() => { try { readSheetRows(makeXlsx({ Sheet1: [["a"]] }), "Bài học"); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });
});

describe("giới hạn chống tệp nén độc", () => {
  const huge = Buffer.alloc(30 * 1024 * 1024, " ");

  it("trang XML 30 MB khoảng trắng (nén còn vài chục KB) → 400 file_too_complex", () => {
    const file = makeXlsx({ "Bài học": [] }, { "Bài học": { data: huge } });
    expect(file.length).toBeLessThan(200_000);
    expect(() => readSheetRows(file, "Bài học")).toThrow(expect.objectContaining({ status: 400, message: "file_too_complex" }));
  });

  it("mục khai kích thước nhỏ nhưng giải nén ra lớn → 400 file_too_complex", () => {
    const file = makeXlsx({ "Bài học": [] }, { "Bài học": { data: huge, declaredSize: 1000 } });
    expect(() => readSheetRows(file, "Bài học")).toThrow(expect.objectContaining({ status: 400, message: "file_too_complex" }));
  });

  it("ô ở dòng hoặc cột rất xa → 400 file_too_complex, không dựng mảng khổng lồ", () => {
    const far = (ref: string) => makeXlsx({ "Bài học": [] }, { "Bài học": { data: Buffer.from(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="${/\d+/.exec(ref)![0]}"><c r="${ref}" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`) } });
    expect(() => readSheetRows(far("A1048576"), "Bài học")).toThrow(expect.objectContaining({ status: 400, message: "file_too_complex" }));
    expect(() => readSheetRows(far("XFD2"), "Bài học")).toThrow(expect.objectContaining({ status: 400, message: "file_too_complex" }));
  });

  it("dòng trống có định dạng ở rất xa (Excel hay ghi) không làm lỗi", () => {
    const file = makeXlsx({ "Bài học": [] }, { "Bài học": { data: Buffer.from(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="1048576" s="1"><c r="A1048576" s="1"/></row></sheetData></worksheet>`) } });
    expect(readSheetRows(file, "Bài học")).toEqual([["a"]]);
  });

  it("không phải tệp zip → 400", () => {
    expect(() => readSheetRows(Buffer.from("not a zip at all"), "Bài học")).toThrow(expect.objectContaining({ status: 400 }));
  });
});
