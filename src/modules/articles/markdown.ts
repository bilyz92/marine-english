// Bộ đọc Markdown nhỏ cho bài viết trong repo (content/bai-viet/*.md): chỉ tiêu đề, đoạn văn, chữ đậm/nghiêng, danh sách, trích dẫn và
// link. Ra cây dữ liệu, trang dựng bằng phần tử React (React tự thoát chữ): không có HTML thô nào đi thẳng ra trang, link chỉ nhận
// đường dẫn trong site hoặc http(s). Tự viết thay vì thêm react-markdown (kéo theo cả bộ unified/remark/micromark) cho chừng ấy cú pháp.

export type Inline = { t: "text"; v: string } | { t: "strong"; c: Inline[] } | { t: "em"; c: Inline[] } | { t: "link"; href: string; c: Inline[] };
export type Block =
  | { t: "h"; level: 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "quote"; c: Block[] };

/** Link được phép: đường dẫn trong site ("/…", không phải "//…" hay "/\…") hoặc http(s). Khác thì null (hiện chữ, không link). */
export function safeHref(href: string): string | null {
  if (/^\/(?![/\\])/.test(href)) return href;
  if (/^https?:\/\/[^\s]+$/i.test(href)) return href;
  return null;
}

// Địa chỉ link cho phép một cặp ngoặc lồng (…/a_(b)), như Markdown thường gặp.
const LINK = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const link = rest.startsWith("[") ? LINK.exec(rest) : null;
    if (link) {
      const href = safeHref(link[2]!);
      flush();
      if (href) out.push({ t: "link", href, c: parseInline(link[1]!) });
      else out.push(...parseInline(link[1]!));
      i += link[0].length;
      continue;
    }
    if (rest.startsWith("**")) {
      const end = findClose(text, i + 2, "**");
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (rest.startsWith("*") && rest.length > 1 && rest[1] !== " ") {
      const end = findClose(text, i + 1, "*");
      if (end > i + 1) {
        flush();
        out.push({ t: "em", c: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return merge(out);
}

/**
 * Vị trí dấu đóng, -1 khi không có. "*" (nghiêng): dấu * kế tiếp không đứng sau khoảng trắng. "**" (đậm): cặp ** kế tiếp, bỏ qua một
 * đoạn nghiêng lồng bên trong ("**x *y***" = đậm của "x *y*").
 */
function findClose(text: string, from: number, marker: "**" | "*"): number {
  for (let j = from; j < text.length; j++) {
    if (marker === "*") {
      if (text[j] === "*" && text[j - 1] !== " ") return j;
      continue;
    }
    if (text.startsWith("**", j)) return j;
    if (text[j] === "*" && text[j + 1] !== " ") {
      const inner = findClose(text, j + 1, "*");
      if (inner > j + 1) j = inner;
    }
  }
  return -1;
}

const merge = (items: Inline[]): Inline[] =>
  items.reduce<Inline[]>((acc, x) => {
    const last = acc[acc.length - 1];
    if (x.t === "text" && last?.t === "text") acc[acc.length - 1] = { t: "text", v: last.v + x.v };
    else acc.push(x);
    return acc;
  }, []);

const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: heading[1]!.length === 3 ? 3 : 2, c: parseInline(heading[2]!.trim()) });
      i += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) inner.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(inner.join("\n")) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const pattern = bullet ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length) {
        const raw = lines[i]!;
        const m = pattern.exec(raw.trim());
        if (m) items.push(bullet ? m[1]! : m[2]!);
        else if (raw.trim() && /^\s/.test(raw) && items.length) items[items.length - 1] += ` ${raw.trim()}`; // dòng thụt vào: tiếp mục trước
        else break;
        i += 1;
      }
      const parsed = items.map((it) => parseInline(it.trim()));
      blocks.push(bullet ? { t: "ul", items: parsed } : { t: "ol", start: Number(numbered![1]), items: parsed });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!.trim();
      if (!l || HEADING.test(l) || l.startsWith(">") || BULLET.test(l) || NUMBERED.test(l)) break;
      para.push(l);
      i += 1;
    }
    blocks.push({ t: "p", c: parseInline(para.join(" ")) });
  }
  return blocks;
}
