import { crc32, deflateRawSync } from "node:zlib";

// Dựng tệp xlsx / zip cho test (chữ ghi thẳng trong ô). declaredSize: khai kích thước giả trong zip để thử bộ đọc.

type Entry = { data: Buffer; declaredSize?: number };

export function makeZip(files: Record<string, string | Buffer | Entry>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const entry: Entry = Buffer.isBuffer(value) || typeof value === "string" ? { data: Buffer.from(value) } : value;
    const packed = deflateRawSync(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const nameBytes = Buffer.from(name, "utf8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(entry.data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(entry.data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(head, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

export function sheetXml(rows: string[][]): string {
  const body = rows
    .map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => (v === "" ? "" : `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("")}</row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Sổ tính nhiều trang; sheetOverride: thay nội dung XML của trang (ví dụ trang khổng lồ để thử giới hạn). */
export function makeXlsx(sheets: Record<string, string[][]>, sheetOverride: Record<string, Entry> = {}): Buffer {
  const names = Object.keys(sheets);
  const files: Record<string, string | Entry> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetOverride[n] ?? sheetXml(sheets[n]!); });
  return makeZip(files);
}
