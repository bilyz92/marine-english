// Đọc ngân hàng câu hỏi phỏng vấn dạng Word (như docs/Engine_Cadet_Three_Levels_v6/nguon/*.docx) thành bộ dữ liệu nháp.
// Chỉ lấy đúng chữ có trong tệp: câu hỏi tiếng Anh, câu phụ, câu mở rộng, nguồn. Không thêm bản dịch hay đáp án.

export type BankQuestion = {
  code: string;
  section: string | null;
  text: string;
  followUps: string[];
  extensions: { reference: string; text: string }[];
  sources: string[];
  notes: string[];
};
export type QuestionBank = { title: string; subtitle: string; sections: { code: string; title: string }[]; questions: BankQuestion[] };

type Paragraph = { style: string | null; text: string };

const decode = (t: string) =>
  t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

function paragraphs(xml: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? null;
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((t) => (t[1] === undefined ? "\t" : decode(t[1]))).join("").trim();
    if (text) out.push({ style, text });
  }
  return out;
}

const QUESTION = /^([A-Z]{1,2}\d{3})\s{2,}(\S[\s\S]*)$/;
const SECTION = /^([A-Z]\d+)\s+(.+)$/;

export function parseQuestionBank(documentXml: string): QuestionBank {
  const ps = paragraphs(documentXml);
  const bank: QuestionBank = { title: ps[0]?.text ?? "", subtitle: ps[1]?.text ?? "", sections: [], questions: [] };
  let inBody = false;
  let section: string | null = null;
  let current: BankQuestion | null = null;
  for (const { style, text } of ps) {
    if (!inBody) {
      if (text === "Part A Common questions") inBody = true;
      continue;
    }
    if (text === "Supporting material and references") break;
    if (style?.startsWith("Heading")) {
      // Chỉ Heading2 dạng "A1 …"/"B1 …" là chủ đề; tiêu đề khác không thuộc câu nào.
      const heading = style === "Heading2" ? SECTION.exec(text) : null;
      if (heading) {
        section = heading[1]!;
        bank.sections.push({ code: section, title: heading[2]! });
      }
      current = null;
      continue;
    }
    const q = QUESTION.exec(text);
    if (q) {
      current = { code: q[1]!, section, text: q[2]!.trim(), followUps: [], extensions: [], sources: [], notes: [] };
      bank.questions.push(current);
      continue;
    }
    if (!current) continue;
    let m: RegExpExecArray | null;
    if ((m = /^Follow-up:\s*(.+)$/.exec(text))) current.followUps.push(m[1]!);
    else if ((m = /^Extension \[([A-Z]+\d+)\]:\s*(.+)$/.exec(text))) current.extensions.push({ reference: m[1]!, text: m[2]! });
    else if ((m = /^Original source:\s*(.+?)\.?$/.exec(text))) current.sources.push(...m[1]!.split(/,\s*/));
    else current.notes.push(text);
  }
  return bank;
}

export type BankLesson = {
  id: string;
  source_display_code: string;
  module_id: string | null;
  module_title: { en: string } | null;
  source_kind: "word_question_bank";
  question: { id: string; text: { en: string } };
  follow_up_questions: { id: string; kind: "follow_up" | "extension"; reference?: string; prompt: { en: string } }[];
  provenance: { document: string; sources: string[]; notes: string[] };
};
export type BankDataset = {
  dataset_id: string;
  content_version: string;
  publication: { status: "draft"; importable: true; source: "word_question_bank" };
  courses: { id: string; title: { en: string; vi: string }; lesson_ids: string[] }[];
  lessons: BankLesson[];
};

const slug = (s: string, sep: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, "g"), "");

/** Bộ dữ liệu nháp: một khóa theo tên tệp, bài `qb-<chức danh>-<mã>` (câu chung dùng chung giữa các tập). */
export function questionBankToDataset(bank: QuestionBank, fileName: string, contentVersion = "word"): BankDataset {
  const rank = slug(bank.title.replace(/\s*Interview Questions\s*$/i, ""), "-") || "word";
  const courseId = slug(fileName.replace(/\.docx$/i, ""), "_");
  const sectionTitle = new Map(bank.sections.map((s) => [s.code, s.title]));
  const lessons = bank.questions.map((q): BankLesson => {
    const id = `qb-${rank}-${q.code}`;
    return {
      id,
      source_display_code: q.code,
      module_id: q.section,
      module_title: q.section && sectionTitle.has(q.section) ? { en: sectionTitle.get(q.section)! } : null,
      source_kind: "word_question_bank",
      question: { id: `${id}.question`, text: { en: q.text } },
      follow_up_questions: [
        ...q.followUps.map((t, i) => ({ id: `${id}.probe.${i + 1}`, kind: "follow_up" as const, prompt: { en: t } })),
        ...q.extensions.map((e, i) => ({ id: `${id}.ext.${i + 1}`, kind: "extension" as const, reference: e.reference, prompt: { en: e.text } })),
      ],
      provenance: { document: fileName, sources: q.sources, notes: q.notes },
    };
  });
  const title = bank.subtitle ? `${bank.title}: ${bank.subtitle}` : bank.title;
  return {
    dataset_id: `word_${courseId}`,
    content_version: contentVersion,
    publication: { status: "draft", importable: true, source: "word_question_bank" },
    // Tệp Word chỉ có tiếng Anh: tên tiếng Việt để nguyên tên gốc cho tới khi chủ sửa.
    courses: [{ id: courseId, title: { en: title, vi: title }, lesson_ids: lessons.map((l) => l.id) }],
    lessons,
  };
}
