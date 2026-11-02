import { createHash } from "node:crypto";
import { parseQuestionBank, questionBankToDataset } from "./docx";
import { readZip, ZipError, type ZipEntry } from "./zip";

// Đọc tệp chủ tải lên thành các bộ dữ liệu cho bộ nhập: .json, .docx (ngân hàng câu hỏi), hoặc .zip (gói học liệu,
// có thể chứa zip lồng một cấp). Giới hạn đặt theo các gói thật (zip lớn nhất 9,3 MB, JSON lớn nhất 4,2 MB).

export class PackageError extends Error {}

export type PackageLimits = { maxUploadBytes: number; maxEntryBytes: number; maxTotalInflated: number; maxEntries: number };
export const PACKAGE_LIMITS: PackageLimits = {
  maxUploadBytes: 16 * 1024 * 1024,
  maxEntryBytes: 12 * 1024 * 1024,
  maxTotalInflated: 48 * 1024 * 1024,
  maxEntries: 200,
};

export type PackageResult = { datasets: unknown[]; sources: string[]; skipped: string[]; sha256: string };

type Dataset = { dataset_id?: unknown; content_version?: unknown; publication?: unknown; courses?: unknown; lessons?: unknown };

const isDataset = (d: unknown): d is Dataset =>
  !!d && typeof d === "object" && !!(d as Dataset).publication && Array.isArray((d as Dataset).courses) && Array.isArray((d as Dataset).lessons);

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const base = (name: string) => name.replace(/\\/g, "/").split("/").pop() ?? name;

export function readPackage(bytes: Buffer, fileName: string, limits: Partial<PackageLimits> = {}): PackageResult {
  const lim = { ...PACKAGE_LIMITS, ...limits };
  if (bytes.length > lim.maxUploadBytes) throw new PackageError(`Tệp lớn hơn ${Math.round(lim.maxUploadBytes / 1024 / 1024)} MB`);
  const out: PackageResult = { datasets: [], sources: [], skipped: [], sha256: createHash("sha256").update(bytes).digest("hex") };
  const seen = new Set<string>();
  let inflated = 0;
  // Giới hạn số mục tính trên cả gói (kể cả thư mục và zip lồng).
  const counter = { entries: 0 };
  const open = (data: Buffer): ZipEntry[] => readZip(data, { maxEntries: lim.maxEntries, counter });

  const take = (entry: ZipEntry): Buffer => {
    const left = lim.maxTotalInflated - inflated;
    if (left <= 0) throw new PackageError("Gói giải nén ra quá lớn");
    let data: Buffer;
    try {
      data = entry.read(Math.min(lim.maxEntryBytes, left));
    } catch (error) {
      if (error instanceof ZipError && left < lim.maxEntryBytes) throw new PackageError("Gói giải nén ra quá lớn");
      throw error;
    }
    inflated += data.length;
    return data;
  };

  const addJson = (data: Buffer, name: string, required: boolean) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString("utf8"));
    } catch {
      if (required) throw new PackageError(`${name} không phải JSON hợp lệ`);
      out.skipped.push(name);
      return;
    }
    if (!isDataset(parsed)) {
      if (required) throw new PackageError(`${name} không phải bộ dữ liệu học (thiếu publication, courses hoặc lessons)`);
      out.skipped.push(name);
      return;
    }
    const key = `${String(parsed.dataset_id ?? name)}@${String(parsed.content_version ?? "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.datasets.push(parsed);
    out.sources.push(name);
  };

  const addDocx = (data: Buffer, name: string) => {
    const doc = open(data).find((e) => e.name === "word/document.xml");
    if (!doc) throw new PackageError(`${name} không phải tệp Word hợp lệ`);
    const bank = parseQuestionBank(take(doc).toString("utf8"));
    if (!bank.questions.length) throw new PackageError(`${name}: không tìm thấy câu hỏi (cần mục "Part A Common questions" và các dòng "A001  …")`);
    const version = `word-${createHash("sha256").update(data).digest("hex").slice(0, 12)}`;
    out.datasets.push(questionBankToDataset(bank, base(name), version));
    out.sources.push(name);
  };

  const walkZip = (data: Buffer, prefix: string, depth: number) => {
    for (const entry of open(data)) {
      const name = prefix + entry.name;
      const kind = ext(entry.name);
      if (kind === "json") addJson(take(entry), name, false);
      else if (kind === "zip" && depth === 0) walkZip(take(entry), `${name}/`, 1);
      else out.skipped.push(name);
    }
  };

  try {
    switch (ext(fileName)) {
      case "json":
        addJson(bytes, fileName, true);
        break;
      case "docx":
        addDocx(bytes, fileName);
        break;
      case "zip":
        walkZip(bytes, "", 0);
        break;
      default:
        throw new PackageError("Chỉ nhận tệp .zip, .json hoặc .docx");
    }
  } catch (error) {
    if (error instanceof ZipError) throw new PackageError(error.message);
    throw error;
  }
  if (!out.datasets.length) throw new PackageError("Không tìm thấy bộ dữ liệu học nào trong tệp");
  return out;
}
