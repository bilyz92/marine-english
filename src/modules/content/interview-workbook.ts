// Tệp Excel "Luyện phỏng vấn Engine Cadet" của chủ (9 trang) → một bộ dữ liệu cho bộ nhập (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md).
// Hàm thuần: nhận hàm đọc một trang. Chữ giữ nguyên từng ký tự như ô Excel; chỉ kiểm, không sửa. Lỗi gom theo dòng để chủ sửa một lần.

export class InterviewWorkbookError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

export const INTERVIEW_COURSE = { id: "mea_cadet_interview", title: { vi: "Luyện phỏng vấn Engine Cadet", en: "Engine Cadet Interview Practice" } };
export const INTERVIEW_SHEETS = { bank: "Ngân hàng", variants: "Cách hỏi", starter: "Tập từ đầu", segments: "Luyện từng ý", advanced: "Mẫu nâng cao" } as const;

type Text = { en: string; vi: string };
export type InterviewLesson = {
  id: string;
  lesson_type: "interview";
  source_kind: "interview_workbook";
  source_display_code: string;
  module_id: string;
  frequency_vi: string;
  question: { text: Text; variants: { id: string; order: number; text: Text }[] };
  bank: { question: Text; model_answer_vi: string; criteria_vi: string };
  basic: Text;
  advanced: Text & { guidance_vi: string };
  starter: { lead_vi: string; correct_vi: string; distractor_vi: string; phrase: Text; first: Text; instruction_vi: string; extra: Text | null };
  segments: { id: string; order: number; text: Text; keyword: string }[];
  personalization?: { bindings: { placeholder: string; field: string }[]; fields: { key: string; label: { vi: string }; type: string }[] };
};

// Chỗ trống → trường hồ sơ trên máy (DATA02). Trường song ngữ: câu tiếng Anh chỉ nhận giá trị tiếng Anh và ngược lại.
const FIELDS: Record<string, { label: string; type: "string" | "localized_text" }> = {
  full_name: { label: "Họ và tên", type: "string" },
  favourite_subject: { label: "Môn học bạn thật sự yêu thích", type: "localized_text" },
  tools_used: { label: "Dụng cụ bạn đã thực sự dùng", type: "localized_text" },
  actual_training: { label: "Đợt huấn luyện thực tế", type: "localized_text" },
  training_experience: { label: "Việc đã học hoặc đã làm dưới sự giám sát", type: "localized_text" },
  feedback_example: { label: "Ví dụ thật về việc học hỏi từ góp ý", type: "localized_text" },
};
const BINDINGS: Record<string, keyof typeof FIELDS> = {
  name: "full_name",
  subject: "favourite_subject",
  tool: "tools_used",
  "tools actually used": "tools_used",
  "ghi các dụng cụ thực tế đã dùng": "tools_used",
  training: "actual_training",
  "quá trình học tập/huấn luyện": "actual_training",
  "describe training or supervised work": "training_experience",
  "mô tả việc đã học hoặc công việc đã làm dưới sự giám sát": "training_experience",
  "give a real example of learning from feedback": "feedback_example",
  "nêu một ví dụ thực tế về việc học hỏi từ góp ý": "feedback_example",
};

/** Mọi chỗ trống {x} hoặc [x] trong chữ. */
export const SLOT = /\{([^{}]+)\}|\[([^\]]+)\]/g;

type Row = { line: number; get: (column: string) => string };
type Sheet = { name: string; rows: Row[] };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Trang theo tên cột ở dòng tiêu đề (dòng có ô "Mã câu"), không theo vị trí cột. */
function sheetOf(read: (name: string) => string[][] | null, name: string, columns: string[], problems: string[]): Sheet | null {
  const rows = read(name);
  if (!rows) {
    problems.push(`Thiếu trang "${name}"`);
    return null;
  }
  const head = rows.findIndex((r) => r.some((c) => c.trim() === "Mã câu"));
  if (head < 0) {
    problems.push(`Trang "${name}": không thấy dòng tiêu đề có cột "Mã câu"`);
    return null;
  }
  const index = new Map(rows[head]!.map((c, i) => [c.trim(), i]));
  const missing = columns.filter((c) => !index.has(c));
  if (missing.length) {
    problems.push(`Trang "${name}": thiếu cột ${missing.map((c) => `"${c}"`).join(", ")}`);
    return null;
  }
  const out: Row[] = [];
  rows.slice(head + 1).forEach((cells, i) => {
    if (!cells.some((c) => c.trim())) return;
    out.push({ line: head + i + 2, get: (column) => cells[index.get(column)!] ?? "" });
  });
  return { name, rows: out };
}

function bindingsFor(lesson: Omit<InterviewLesson, "personalization">): InterviewLesson["personalization"] {
  const used = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(SLOT)) used.add((m[1] ?? m[2])!);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  // Đáp án mẫu tiếng Việt và tiêu chí chỉ để đọc: nhãn trong đó không cần điền.
  walk({ ...lesson, bank: { question: lesson.bank.question } });
  const bindings = [...used].filter((p) => BINDINGS[p]).map((p) => ({ placeholder: p, field: BINDINGS[p]! }));
  if (!bindings.length) return undefined;
  const keys = [...new Set(bindings.map((b) => b.field))];
  return { bindings, fields: keys.map((k) => ({ key: k, label: { vi: FIELDS[k]!.label }, type: FIELDS[k]!.type })) };
}

/** Đổi workbook thành bộ dữ liệu. `read(tên trang)` trả các dòng (ô trống là "") hoặc null khi không có trang. */
export function interviewWorkbookToDataset(read: (name: string) => string[][] | null, contentVersion: string) {
  const problems: string[] = [];
  const S = INTERVIEW_SHEETS;
  const bank = sheetOf(read, S.bank, ["Mã câu", "Khả năng hỏi", "Chủ đề", "Thứ tự", "Câu hỏi tiếng Anh", "Câu hỏi tiếng Việt", "Đáp án cơ bản (tiếng Anh)", "Bản dịch tiếng Việt (đáp án cơ bản)", "Đáp án nâng cao (tiếng Anh)", "Bản dịch tiếng Việt (đáp án nâng cao)", "Đáp án mẫu tiếng Việt", "Tiêu chí đánh giá câu trả lời"], problems);
  const variants = sheetOf(read, S.variants, ["Mã câu", "Mã cách hỏi", "Thứ tự", "Câu hỏi tiếng Anh", "Nghĩa tiếng Việt"], problems);
  const starter = sheetOf(read, S.starter, ["Mã câu", "Lời dẫn tiếng Việt", "Lựa chọn đúng", "Lựa chọn nhiễu", "Cụm nghe tiếng Anh", "Nghĩa của cụm", "Câu đầu để đọc theo", "Nghĩa của câu đầu", "Hướng dẫn cho học viên", "Từ nghe thêm (tùy chọn)", "Nghĩa của từ thêm"], problems);
  const segments = sheetOf(read, S.segments, ["Mã câu", "Mã đoạn", "Thứ tự", "Đoạn tiếng Anh", "Nghĩa của đoạn", "Từ khóa gợi nhớ"], problems);
  const advanced = sheetOf(read, S.advanced, ["Mã câu", "Đáp án nâng cao tiếng Anh", "Bản dịch tiếng Việt", "Hướng dẫn khi cần"], problems);
  if (!bank || !variants || !starter || !segments || !advanced) throw new InterviewWorkbookError(problems);

  const at = (sheet: Sheet, row: Row, code: string) => `Trang "${sheet.name}", dòng ${row.line}${code ? `, ${code}` : ""}`;
  const need = (sheet: Sheet, row: Row, code: string, columns: string[]) => {
    for (const c of columns) if (!row.get(c).trim()) problems.push(`${at(sheet, row, code)}: thiếu "${c}"`);
  };
  const order = (sheet: Sheet, row: Row, code: string): number => {
    const n = Number(row.get("Thứ tự").trim());
    if (!Number.isInteger(n) || n < 1) problems.push(`${at(sheet, row, code)}: "Thứ tự" phải là số nguyên dương`);
    return n;
  };

  const codes = new Map<string, Row>();
  for (const row of bank.rows) {
    const code = row.get("Mã câu").trim();
    if (!/^EC-\d{3}$/.test(code)) {
      problems.push(`${at(bank, row, "")}: mã câu "${code}" không đúng dạng EC-000`);
      continue;
    }
    if (codes.has(code)) {
      problems.push(`${at(bank, row, code)}: trùng mã với dòng ${codes.get(code)!.line}`);
      continue;
    }
    codes.set(code, row);
    order(bank, row, code);
    need(bank, row, code, ["Chủ đề", "Câu hỏi tiếng Anh", "Câu hỏi tiếng Việt", "Đáp án cơ bản (tiếng Anh)", "Bản dịch tiếng Việt (đáp án cơ bản)", "Đáp án nâng cao (tiếng Anh)", "Bản dịch tiếng Việt (đáp án nâng cao)"]);
  }
  if (!codes.size && !problems.length) problems.push(`Trang "${S.bank}": không có câu hỏi nào`);

  /** Dòng của các trang phụ theo mã câu; mã không có trong Ngân hàng là lỗi. */
  const group = (sheet: Sheet) => {
    const by = new Map<string, Row[]>();
    for (const row of sheet.rows) {
      const code = row.get("Mã câu").trim();
      if (!codes.has(code)) {
        problems.push(`${at(sheet, row, code)}: mã câu không có trong trang "${S.bank}"`);
        continue;
      }
      by.set(code, [...(by.get(code) ?? []), row]);
    }
    return by;
  };
  const variantRows = group(variants);
  const starterRows = group(starter);
  const segmentRows = group(segments);
  const advancedRows = group(advanced);

  const sorted = (sheet: Sheet, rows: Row[], code: string) => {
    const seen = new Set<number>();
    const withOrder = rows.map((row) => {
      const n = order(sheet, row, code);
      if (seen.has(n)) problems.push(`${at(sheet, row, code)}: trùng "Thứ tự" ${n}`);
      seen.add(n);
      return { row, n };
    });
    return withOrder.sort((a, b) => a.n - b.n);
  };

  const topics: { id: string; title: { vi: string; en: string }; lesson_ids: string[] }[] = [];
  const lessons: InterviewLesson[] = [];
  const ordered = [...codes].sort(([, a], [, b]) => Number(a.get("Thứ tự")) - Number(b.get("Thứ tự")));
  for (const [code, row] of ordered) {
    const v = sorted(variants, variantRows.get(code) ?? [], code);
    const st = starterRows.get(code) ?? [];
    const sg = sorted(segments, segmentRows.get(code) ?? [], code);
    const adv = advancedRows.get(code) ?? [];
    const where = `${at(bank, row, code)}`;
    if (!v.length) problems.push(`${where}: chưa có cách hỏi ở trang "${S.variants}"`);
    if (st.length !== 1) problems.push(`${where}: cần đúng một dòng ở trang "${S.starter}" (đang có ${st.length})`);
    if (!sg.length) problems.push(`${where}: chưa có đoạn nào ở trang "${S.segments}"`);
    if (adv.length !== 1) problems.push(`${where}: cần đúng một dòng ở trang "${S.advanced}" (đang có ${adv.length})`);
    for (const x of v) need(variants, x.row, code, ["Mã cách hỏi", "Câu hỏi tiếng Anh", "Nghĩa tiếng Việt"]);
    for (const x of sg) need(segments, x.row, code, ["Mã đoạn", "Đoạn tiếng Anh", "Nghĩa của đoạn"]);
    const basicEn = row.get("Đáp án cơ bản (tiếng Anh)");
    if (sg.length && squash(sg.map((x) => x.row.get("Đoạn tiếng Anh")).join(" ")) !== squash(basicEn)) {
      problems.push(`${where}: các đoạn ở trang "${S.segments}" nối lại không đúng bằng đáp án cơ bản (tiếng Anh)`);
    }
    const a = adv[0];
    if (a) {
      need(advanced, a, code, ["Đáp án nâng cao tiếng Anh", "Bản dịch tiếng Việt"]);
      if (squash(a.get("Đáp án nâng cao tiếng Anh")) !== squash(row.get("Đáp án nâng cao (tiếng Anh)"))) {
        problems.push(`${at(advanced, a, code)}: đáp án nâng cao khác trang "${S.bank}"`);
      }
    }
    const s = st[0];
    if (s) need(starter, s, code, ["Lời dẫn tiếng Việt", "Lựa chọn đúng", "Lựa chọn nhiễu", "Cụm nghe tiếng Anh", "Nghĩa của cụm", "Câu đầu để đọc theo", "Nghĩa của câu đầu"]);
    if (problems.length) continue;

    const topicName = row.get("Chủ đề").trim();
    let topic = topics.find((t) => t.title.vi === topicName);
    if (!topic) {
      topic = { id: `T${String(topics.length + 1).padStart(2, "0")}`, title: { vi: topicName, en: "" }, lesson_ids: [] };
      topics.push(topic);
    }
    const id = code;
    topic.lesson_ids.push(id);
    const extraEn = s!.get("Từ nghe thêm (tùy chọn)");
    const base: Omit<InterviewLesson, "personalization"> = {
      id,
      lesson_type: "interview",
      source_kind: "interview_workbook",
      source_display_code: code,
      module_id: topic.id,
      frequency_vi: row.get("Khả năng hỏi"),
      question: {
        text: { en: v[0]!.row.get("Câu hỏi tiếng Anh"), vi: v[0]!.row.get("Nghĩa tiếng Việt") },
        variants: v.map((x) => ({ id: x.row.get("Mã cách hỏi").trim(), order: x.n, text: { en: x.row.get("Câu hỏi tiếng Anh"), vi: x.row.get("Nghĩa tiếng Việt") } })),
      },
      bank: { question: { en: row.get("Câu hỏi tiếng Anh"), vi: row.get("Câu hỏi tiếng Việt") }, model_answer_vi: row.get("Đáp án mẫu tiếng Việt"), criteria_vi: row.get("Tiêu chí đánh giá câu trả lời") },
      basic: { en: basicEn, vi: row.get("Bản dịch tiếng Việt (đáp án cơ bản)") },
      advanced: { en: a!.get("Đáp án nâng cao tiếng Anh"), vi: a!.get("Bản dịch tiếng Việt"), guidance_vi: a!.get("Hướng dẫn khi cần") },
      starter: {
        lead_vi: s!.get("Lời dẫn tiếng Việt"),
        correct_vi: s!.get("Lựa chọn đúng"),
        distractor_vi: s!.get("Lựa chọn nhiễu"),
        phrase: { en: s!.get("Cụm nghe tiếng Anh"), vi: s!.get("Nghĩa của cụm") },
        first: { en: s!.get("Câu đầu để đọc theo"), vi: s!.get("Nghĩa của câu đầu") },
        instruction_vi: s!.get("Hướng dẫn cho học viên"),
        extra: extraEn.trim() ? { en: extraEn, vi: s!.get("Nghĩa của từ thêm") } : null,
      },
      segments: sg.map((x) => ({ id: x.row.get("Mã đoạn").trim(), order: x.n, text: { en: x.row.get("Đoạn tiếng Anh"), vi: x.row.get("Nghĩa của đoạn") }, keyword: x.row.get("Từ khóa gợi nhớ") })),
    };
    const personalization = bindingsFor(base);
    lessons.push(personalization ? { ...base, personalization } : base);
  }
  if (problems.length) throw new InterviewWorkbookError(problems);
  return {
    dataset_id: "interview_workbook_engine_cadet",
    content_version: contentVersion,
    publication: { status: "draft", importable: true, source: "interview_workbook" },
    catalog: { modules: topics },
    courses: [{ id: INTERVIEW_COURSE.id, title: INTERVIEW_COURSE.title, lesson_ids: lessons.map((l) => l.id) }],
    lessons,
  };
}
