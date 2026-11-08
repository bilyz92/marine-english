// Dựng khung bài giảng mẫu (Excel) cho trang quản trị: node scripts/build-lesson-template.mjs
// Ghi src/assets/khung-bai-giang-mau.xlsx. Không dùng thư viện: xlsx là tệp zip chứa vài tệp XML (chữ ghi thẳng trong ô).
// Hai bài mẫu lấy nguyên từ học liệu Engine Cadet (A001 hỏi–đáp, A022 làm tự luận), không bịa nội dung.
// Thứ tự cột phải khớp HEADERS trong src/modules/content/excel-import.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const OUT = "src/assets/khung-bai-giang-mau.xlsx";
const DATA = "docs/Engine_Cadet_Three_Levels_v6/Engine_Cadet_Learning_Data_v6.json";

const HEADERS = [
  "Module *",
  "Mã chủ đề",
  "Tên chủ đề",
  "Loại bài * (Hỏi–đáp / Tự luận)",
  "Câu hỏi / Đề bài (tiếng Anh) *",
  "Câu hỏi / Đề bài (tiếng Việt)",
  "Ý chính (mỗi dòng: tiếng Anh | tiếng Việt)",
  "Từ vựng (mỗi dòng: tiếng Anh | tiếng Việt)",
  "Đáp án mẫu (tiếng Anh)",
  "Đáp án mẫu (tiếng Việt)",
  "Câu hỏi phụ (mỗi dòng: tiếng Anh | tiếng Việt)",
];
const WIDTHS = [26, 12, 30, 18, 50, 50, 50, 40, 60, 60, 50];

const GUIDE = [
  ["Khung bài giảng mẫu — Marine English"],
  ["Điền bài ở trang “Bài học”, mỗi dòng một bài, rồi tải tệp lên ở trang quản trị của khóa (nút “Tải lên file Excel”)."],
  ["Bài mới được thêm vào cuối khóa. Hệ thống cho xem trước và báo lỗi theo từng dòng; chỉ khi không còn lỗi mới thêm bài."],
  [""],
  ["Cột", "Cách điền"],
  [HEADERS[0], "Bắt buộc. Tên module, ví dụ “Kinh nghiệm phỏng vấn”. Module chưa có trong khóa sẽ được tạo mới theo thứ tự xuất hiện trong tệp."],
  [HEADERS[1], "Không bắt buộc. Mã chủ đề dạng chữ hoa + số, ví dụ A1, B12. Có tên chủ đề thì phải có mã."],
  [HEADERS[2], "Bắt buộc khi mã chủ đề là mã mới trong khóa. Cùng một mã thì cùng một tên."],
  [HEADERS[3], "Bắt buộc. Chỉ nhận “Hỏi–đáp” hoặc “Tự luận”. Video và Nói theo chưa nhập được bằng Excel."],
  [HEADERS[4], "Bắt buộc."],
  [HEADERS[5], "Không bắt buộc."],
  [HEADERS[6], "Mỗi ý một dòng trong ô (Alt+Enter để xuống dòng): tiếng Anh | tiếng Việt. Tối đa 10 ý."],
  [HEADERS[7], "Mỗi từ một dòng: tiếng Anh | tiếng Việt. Tối đa 40 từ."],
  [HEADERS[8], "Bắt buộc với bài Tự luận (học viên viết xong mở đáp án mẫu để tự so). Hỏi–đáp để trống nếu chưa có."],
  [HEADERS[9], "Không bắt buộc."],
  [HEADERS[10], "Chỉ dùng cho bài Hỏi–đáp. Mỗi câu một dòng: tiếng Anh | tiếng Việt. Tối đa 20 câu."],
  [""],
  ["Giới hạn: tối đa 300 bài mỗi tệp, tệp không quá 2 MB. Không đổi tên, thứ tự cột hay tên trang “Bài học”."],
];

const pairs = (items) => items.map((t) => (t.vi ? `${t.en} | ${t.vi}` : t.en)).join("\n");

function sampleRows() {
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  const lesson = (id) => data.lessons.find((l) => l.id === id);
  const topicName = (id) => data.catalog.modules.find((m) => m.id === id).title.vi.replace(new RegExp(`^${id}\\s+`), "");
  const row = (l, module, type) => [
    module,
    l.module_id,
    topicName(l.module_id),
    type,
    l.question.text.en,
    l.question.text.vi ?? "",
    pairs(l.key_points.map((k) => k.text)),
    pairs((l.vocabulary ?? []).map((v) => v.text ?? { en: v.en, vi: v.vi })),
    l.model_answer?.text.en ?? "",
    l.model_answer?.text.vi ?? "",
    type === "Hỏi–đáp" ? pairs((l.follow_up_questions ?? []).map((q) => q.prompt)) : "",
  ];
  return [row(lesson("A001"), "Kinh nghiệm phỏng vấn", "Hỏi–đáp"), row(lesson("A022"), "Kinh nghiệm vận hành sửa chữa", "Tự luận")];
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => String.fromCharCode(65 + i);

function sheetXml(rows, { widths, freeze }) {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const body = rows
    .map((cells, r) => `<row r="${r + 1}">${cells
      .map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr" s="${r === 0 || (freeze === false && r === 4) ? 1 : 2}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)
      .join("")}</row>`)
    .join("");
  const pane = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const FILES = (guide, lessons) => ({
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="1"/></bookViews><sheets><sheet name="Hướng dẫn" sheetId="1" r:id="rId1"/><sheet name="Bài học" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  // Kiểu 0: mặc định; 1: tiêu đề in đậm, nền nhạt, xuống dòng; 2: chữ thường, xuống dòng, canh trên.
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": sheetXml(guide, { widths: [44, 110], freeze: false }),
  "xl/worksheets/sheet2.xml": sheetXml(lessons, { widths: WIDTHS, freeze: true }),
});

/** Zip tối thiểu (nén deflate), đủ cho Excel, LibreOffice và bộ đọc src/modules/content/zip.ts. Giờ cố định để tệp dựng lại y hệt. */
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x5b21, 12); // 01/09/2025 00:00
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26); head.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x5b21, 14);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(head, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

mkdirSync("src/assets", { recursive: true });
writeFileSync(OUT, zip(FILES(GUIDE, [HEADERS, ...sampleRows()])));
console.log(`Đã ghi ${OUT}`);
