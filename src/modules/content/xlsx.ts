import { HttpError } from "@/lib/http";
import { readZip, ZipError, type ZipEntry } from "./zip";

// Đọc một trang của tệp .xlsx (zip chứa XML) không cần thư viện: chuỗi chia sẻ, chuỗi ghi thẳng trong ô, số.
// Chống tệp nén độc: tối đa 50 mục, mỗi mục giải nén tối đa 8 MB (theo số byte giải nén thật), tổng tối đa 20 MB.

const MAX_ENTRIES = 50;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// Ô có chữ ở quá xa thì coi là tệp lạ (không dựng mảng khổng lồ); dòng/ô trống có định dạng ở xa thì bỏ qua.
const MAX_ROWS = 20_000;
const MAX_COLS = 64;

const decode = (t: string) =>
  t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    // Excel ghi ký tự điều khiển dạng _xHHHH_ (ví dụ _x000D_ cho xuống dòng kiểu Windows).
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\r\n?/g, "\n");

/** Chữ của một ô chuỗi hoặc một mục chuỗi chia sẻ: nối các đoạn <t>, bỏ phần phiên âm <rPh>. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join("");

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function reader(bytes: Buffer) {
  let entries: ZipEntry[];
  try {
    entries = readZip(bytes, { maxEntries: MAX_ENTRIES });
  } catch (error) {
    if (error instanceof ZipError) throw new HttpError(400, /quá nhiều mục/.test(error.message) ? "file_too_complex" : "not_xlsx");
    throw error;
  }
  let total = 0;
  return (name: string): string | null => {
    const entry = entries.find((e) => e.name === name);
    if (!entry) return null;
    if (entry.size > MAX_ENTRY_BYTES || total + entry.size > MAX_TOTAL_BYTES) throw new HttpError(400, "file_too_complex");
    let data: Buffer;
    try {
      data = entry.read(MAX_ENTRY_BYTES);
    } catch (error) {
      if (error instanceof ZipError) throw new HttpError(400, error.reason === "too_large" ? "file_too_complex" : "not_xlsx");
      throw error;
    }
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new HttpError(400, "file_too_complex");
    return data.toString("utf8");
  };
}

/** Các dòng của trang tên `sheetName`; ô trống là "", giữ xuống dòng trong ô. Không thấy trang → 400 sheet_missing. */
export function readSheetRows(bytes: Buffer, sheetName: string): string[][] {
  const read = reader(bytes);
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new HttpError(400, "not_xlsx");
  const sheet = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => m[1]!).find((attrs) => decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? "") === sheetName);
  const relId = sheet && /\br:id="([^"]+)"/.exec(sheet)?.[1];
  const rel = relId && [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]!).find((attrs) => /\bId="([^"]+)"/.exec(attrs)?.[1] === relId);
  const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1];
  if (!target) throw new HttpError(400, "sheet_missing");
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const xml = read(path);
  if (!xml) throw new HttpError(400, "not_xlsx");
  const sharedXml = read("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];

  const rows: string[][] = [];
  let nextRow = 0;
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? nextRow + 1) - 1;
    nextRow = rowNo + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const text = type === "inlineStr" ? textOf(body) : type === "s" ? (shared[Number(value)] ?? "") : value !== undefined ? decode(value) : "";
      if (!text) continue;
      if (col >= MAX_COLS || !Number.isSafeInteger(rowNo) || rowNo >= MAX_ROWS) throw new HttpError(400, "file_too_complex");
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    if (!cells.length) continue;
    while (rows.length < rowNo) rows.push([]);
    rows[rowNo] = cells;
  }
  return rows;
}
