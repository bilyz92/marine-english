import ui from "@/components/ui.module.css";
import styles from "./course.module.css";

// Mô tả khóa do chủ soạn (chủ 26/11/2026). Chữ thuần, không HTML: dòng trống tách đoạn, dòng "## …" là tiêu đề,
// đoạn mà mọi dòng bắt đầu bằng "* " hoặc "- " là danh sách. React tự thoát ký tự nên chữ chủ gõ không thành mã.
type Block = { kind: "h"; text: string } | { kind: "ul"; items: string[] } | { kind: "p"; lines: string[] };

const BULLET = /^[*-]\s+/;

export function parseDescription(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (para.length) blocks.push({ kind: "p", lines: para });
      if (list.length) blocks.push({ kind: "ul", items: list });
      para = [];
      list = [];
    };
    for (const line of lines) {
      if (line.startsWith("## ")) {
        flush();
        blocks.push({ kind: "h", text: line.slice(3).trim() });
      } else if (BULLET.test(line)) {
        if (para.length) flush();
        list.push(line.replace(BULLET, ""));
      } else {
        if (list.length) flush();
        para.push(line);
      }
    }
    flush();
  }
  return blocks;
}

export function CourseDescription({ text }: { text: string }) {
  return (
    <section className={`${ui.card} ${styles.about}`} aria-label="Giới thiệu khóa học">
      {parseDescription(text).map((b, i) =>
        b.kind === "h" ? <h2 key={i} className={ui.h3}>{b.text}</h2>
        : b.kind === "ul" ? <ul key={i}>{b.items.map((t, k) => <li key={k}>{t}</li>)}</ul>
        : <p key={i}>{b.lines.map((l, k) => <span key={k}>{k > 0 && <br />}{l}</span>)}</p>,
      )}
    </section>
  );
}
