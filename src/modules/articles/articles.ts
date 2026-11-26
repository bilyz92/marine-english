import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isUrlSlug } from "@/modules/content/url-slug";
import { parseMarkdown, type Block } from "./markdown";

// Bài viết "Bài viết" (SEO, chủ 26/11/2026): tệp Markdown trong repo, content/bai-viet/<đường dẫn>.md, phần đầu tệp (frontmatter) có
// tieu_de, mo_ta, duong_dan (/bai-viet/<đường dẫn>, trùng tên tệp), ngay (YYYY-MM-DD). Tệp sai thì ném lỗi (lỗi lúc build, không lặng
// lẽ bỏ bài). Bản standalone mang theo thư mục này qua outputFileTracingIncludes (next.config.ts).

export type ArticleMeta = { slug: string; title: string; description: string; path: string; date: string };
export type Article = ArticleMeta & { blocks: Block[] };

const DIR = path.join(process.cwd(), "content", "bai-viet");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Phần đầu tệp: từng dòng `khóa: giá trị`, giá trị có thể nằm trong ngoặc kép (chuỗi JSON). */
function frontmatter(source: string, file: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) throw new Error(`${file}: thiếu phần đầu --- … ---`);
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${file}: dòng phần đầu không đọc được: ${line}`);
    const raw = kv[2]!.trim();
    fields[kv[1]!] = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  }
  return { fields, body: source.slice(m[0].length) };
}

export function parseArticle(file: string, source: string): Article {
  const { fields, body } = frontmatter(source, file);
  const need = (key: string) => {
    const v = fields[key]?.trim();
    if (!v) throw new Error(`${file}: thiếu ${key}`);
    return v;
  };
  const route = need("duong_dan");
  const slug = route.replace(/^\/bai-viet\//, "");
  if (!route.startsWith("/bai-viet/") || !isUrlSlug(slug)) throw new Error(`${file}: duong_dan phải là /bai-viet/<chữ-thường-không-dấu>`);
  if (path.basename(file) !== `${slug}.md`) throw new Error(`${file}: tên tệp phải là ${slug}.md (theo duong_dan)`);
  const date = need("ngay");
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`${file}: ngay phải là YYYY-MM-DD`);
  return { slug, title: need("tieu_de"), description: need("mo_ta"), path: route, date, blocks: parseMarkdown(body) };
}

/** Đọc và kiểm một lần mỗi tiến trình: bài chỉ đổi theo commit + deploy (proxy gọi mỗi yêu cầu /bai-viet/…). */
let all: Article[] | null = null;
function readAll(): Article[] {
  all ??= readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseArticle(path.join(DIR, f), readFileSync(path.join(DIR, f), "utf8")));
  return all;
}

/** Mọi bài, mới nhất trước (cùng ngày thì theo đường dẫn). */
export function listArticles(): ArticleMeta[] {
  return readAll()
    .map(({ blocks: _blocks, ...meta }) => meta)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function getArticle(slug: string): Article | null {
  return readAll().find((a) => a.slug === slug) ?? null;
}
