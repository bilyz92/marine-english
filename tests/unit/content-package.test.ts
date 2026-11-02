import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZip, ZipError } from "@/modules/content/zip";
import { parseQuestionBank, questionBankToDataset } from "@/modules/content/docx";
import { readPackage, PackageError } from "@/modules/content/package";
import { makeZip, questionBankXml } from "../helpers/zip";

const BANK = [
  { text: "Engine Cadet Interview Questions" },
  { text: "Container ships" },
  { text: "Contents" },
  { text: "A1 Education background and career goals" },
  { text: "Supporting material and references" },
  { text: "Part A Common questions", style: "Heading1" },
  { text: "A1 Education background and career goals", style: "Heading2" },
  { text: "A001  Please introduce yourself & your studies." },
  { text: "Follow-up: State your university." },
  { text: "Extension [W02]: How would you report fatigue?" },
  { text: "Original source: S01, S02." },
  { text: "A019  How do you use your TRB?" },
  { text: "Extension [W11]: How do you check the TRB?" },
  { text: "Developed from A011 and A012 to address TRB requirements." },
  { text: "Notes for interviewers", style: "Heading3" },
  { text: "B1 Container ships", style: "Heading2" },
  { text: "K001  How do you relate the refrigeration cycle to a reefer unit?" },
  { text: "Follow-up: Describe what you observed." },
  { text: "Supporting material and references", style: "Heading1" },
  { text: "W01  IMO STCW Code Manila Amendments 2010" },
];

describe("zip", () => {
  it("đọc mục lưu thẳng và deflate", () => {
    const zip = readZip(makeZip([{ name: "a.txt", data: "xin chào", method: 0 }, { name: "b/c.json", data: '{"x":1}' }]));
    expect(zip.map((e) => e.name)).toEqual(["a.txt", "b/c.json"]);
    expect(zip[0]!.read(100).toString()).toBe("xin chào");
    expect(JSON.parse(zip[1]!.read(100).toString())).toEqual({ x: 1 });
  });

  it("chặn tên mục có .. hoặc đường dẫn tuyệt đối", () => {
    expect(() => readZip(makeZip([{ name: "../x.json", data: "{}" }]))).toThrow(ZipError);
    expect(() => readZip(makeZip([{ name: "/etc/x", data: "{}" }]))).toThrow(ZipError);
    expect(() => readZip(makeZip([{ name: "a\\..\\x", data: "{}" }]))).toThrow(ZipError);
  });

  it("zip bomb: giải nén vượt giới hạn thì dừng, kể cả khi khai kích thước nhỏ", () => {
    const bomb = makeZip([{ name: "big.json", data: Buffer.alloc(5_000_000, 32), declaredSize: 10 }]);
    const [entry] = readZip(bomb);
    expect(() => entry!.read(1_000_000)).toThrow(ZipError);
  });

  it("mục lưu thẳng khai sai kích thước, hoặc sai CRC → lỗi", () => {
    const [lie] = readZip(makeZip([{ name: "a.json", data: "x".repeat(5000), method: 0, declaredSize: 10 }]));
    expect(() => lie!.read(100)).toThrow(ZipError);
    const bad = makeZip([{ name: "a.txt", data: "hello", method: 0 }]);
    bad[bad.indexOf("hello")] = 0x48;
    expect(() => readZip(bad)[0]!.read(100)).toThrow(ZipError);
  });

  it("quá số mục hoặc không phải zip → lỗi", () => {
    const many = makeZip(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, data: "x" })));
    expect(() => readZip(many, { maxEntries: 5 })).toThrow(ZipError);
    expect(() => readZip(Buffer.from("không phải zip"))).toThrow(ZipError);
  });
});

describe("ngân hàng câu hỏi Word", () => {
  it("đọc câu chính, câu phụ, mở rộng, nguồn, ghi chú; bỏ mục lục và phần tham chiếu", () => {
    const bank = parseQuestionBank(questionBankXml(BANK));
    expect(bank.title).toBe("Engine Cadet Interview Questions");
    expect(bank.subtitle).toBe("Container ships");
    expect(bank.questions.map((q) => q.code)).toEqual(["A001", "A019", "K001"]);
    const [a001, a019, k001] = bank.questions;
    expect(a001).toMatchObject({ section: "A1", text: "Please introduce yourself & your studies.", followUps: ["State your university."], sources: ["S01", "S02"] });
    expect(a001!.extensions).toEqual([{ reference: "W02", text: "How would you report fatigue?" }]);
    expect(a019!.notes).toEqual(["Developed from A011 and A012 to address TRB requirements."]);
    expect(k001!.section).toBe("B1");
    expect(bank.sections).toEqual([{ code: "A1", title: "Education background and career goals" }, { code: "B1", title: "Container ships" }]);
  });

  it("thành bộ dữ liệu nháp: chỉ câu hỏi tiếng Anh, không đáp án, mã bài theo chức danh", () => {
    const data = questionBankToDataset(parseQuestionBank(questionBankXml(BANK)), "Engine_Cadet_03_Container_EN.docx");
    expect(data.publication).toEqual({ status: "draft", importable: true, source: "word_question_bank" });
    expect(data.courses).toEqual([{ id: "engine_cadet_03_container_en", title: { en: "Engine Cadet Interview Questions: Container ships", vi: "Engine Cadet Interview Questions: Container ships" }, lesson_ids: ["qb-engine-cadet-A001", "qb-engine-cadet-A019", "qb-engine-cadet-K001"] }]);
    const a001 = data.lessons[0]!;
    expect(a001.question).toEqual({ id: "qb-engine-cadet-A001.question", text: { en: "Please introduce yourself & your studies." } });
    expect(a001.follow_up_questions).toEqual([
      { id: "qb-engine-cadet-A001.probe.1", kind: "follow_up", prompt: { en: "State your university." } },
      { id: "qb-engine-cadet-A001.ext.1", kind: "extension", reference: "W02", prompt: { en: "How would you report fatigue?" } },
    ]);
    expect(a001).not.toHaveProperty("model_answer");
    expect(a001).not.toHaveProperty("key_points");
  });
});

describe("tệp thật (bắt buộc)", () => {
  const docx = (n: string) => readFileSync(`docs/Engine_Cadet_Three_Levels_v6/nguon/Engine_Cadet_${n}_EN.docx`);
  it.each([
    ["01_Tankers", 58, ["T001", "T002"], 53, 13],
    ["02_Dry_Cargo", 59, ["H001", "H002", "H003"], 53, 14],
    ["03_Container", 58, ["K001", "K002"], 53, 13],
  ])("Word %s: %i câu chính", (name, main, vessel, followUps, extensions) => {
    const pkg = readPackage(docx(name as string), `Engine_Cadet_${name}_EN.docx`);
    expect(pkg.datasets).toHaveLength(1);
    const data = pkg.datasets[0] as ReturnType<typeof questionBankToDataset>;
    const codes = data.lessons.map((l) => l.source_display_code);
    expect(codes).toHaveLength(main as number);
    expect(codes.slice(-(vessel as string[]).length)).toEqual(vessel);
    expect(codes.filter((c) => c.startsWith("A"))).toHaveLength(56);
    expect(codes.some((c) => c.startsWith("W"))).toBe(false);
    const all = data.lessons.flatMap((l) => l.follow_up_questions);
    expect(all.filter((f) => f.kind === "follow_up")).toHaveLength(followUps as number);
    expect(all.filter((f) => f.kind === "extension")).toHaveLength(extensions as number);
  });

  it.each([
    ["Oiler", "oiler_bilingual_three_level_learning_v1", 120, { oiler_tanker: 98, oiler_dry_cargo: 99, oiler_container: 95 }],
    ["Wiper", "wiper_bilingual_three_level_learning_v1", 107, { wiper_tanker: 86, wiper_dry_cargo: 87, wiper_container: 82 }],
  ])("JSON %s trong zip (kèm zip lồng trùng bộ, pdf, Thumbs.db)", (rank, datasetId, lessons, counts) => {
    const json = readFileSync(`docs/${rank}_Bilingual_Three_Levels_v1/${rank}_Learning_Data_v1.json`);
    const inner = makeZip([{ name: "pack/data.json", data: json }]);
    const outer = makeZip([
      { name: `${rank}/${rank}_Learning_Data_v1.json`, data: json },
      { name: `${rank}/pack.zip`, data: inner, method: 0 },
      { name: `${rank}/x.pdf`, data: "%PDF" },
      { name: "Thumbs.db", data: "x" },
      { name: `${rank}/validation.json`, data: '{"status":"passed"}' },
    ]);
    const pkg = readPackage(outer, `0x_${rank}.zip`);
    expect(pkg.datasets).toHaveLength(1);
    const data = pkg.datasets[0] as { dataset_id: string; lessons: unknown[]; courses: { id: string; lesson_ids: string[] }[] };
    expect(data.dataset_id).toBe(datasetId);
    expect(data.lessons).toHaveLength(lessons as number);
    expect(Object.fromEntries(data.courses.map((c) => [c.id, c.lesson_ids.length]))).toEqual(counts);
  });
});

describe("gói", () => {
  it("tệp quá lớn, đuôi lạ, zip không có bộ dữ liệu → lỗi rõ ràng", () => {
    expect(() => readPackage(Buffer.alloc(20), "a.zip", { maxUploadBytes: 10 })).toThrow(PackageError);
    expect(() => readPackage(Buffer.from("x"), "a.exe")).toThrow(PackageError);
    expect(() => readPackage(makeZip([{ name: "a.txt", data: "x" }]), "a.zip")).toThrow(PackageError);
    expect(() => readPackage(Buffer.from("{bad"), "a.json")).toThrow(PackageError);
  });

  it("số mục tính trên cả gói, kể cả zip lồng", () => {
    const inner = makeZip(Array.from({ length: 4 }, (_, i) => ({ name: `i${i}.txt`, data: "x" })));
    const outer = makeZip([{ name: "a.zip", data: inner }, { name: "b.zip", data: inner }]);
    expect(() => readPackage(outer, "a.zip", { maxEntries: 6 })).toThrow(PackageError);
    const dirs = makeZip([...Array.from({ length: 5 }, (_, i) => ({ name: `d${i}/`, data: "", method: 0 as const })), { name: "a.zip", data: inner }]);
    expect(() => readPackage(dirs, "a.zip", { maxEntries: 8 })).toThrow(PackageError);
  });

  it("tổng dung lượng giải nén bị giới hạn", () => {
    const one = Buffer.from(JSON.stringify({ publication: { importable: true }, courses: [], lessons: [], pad: "x".repeat(4000) }));
    const zip = makeZip([{ name: "a.json", data: one }, { name: "b.json", data: one }]);
    expect(() => readPackage(zip, "a.zip", { maxTotalInflated: 6000 })).toThrow(PackageError);
  });
});
