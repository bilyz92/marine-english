import Link from "next/link";
import type { Block, Inline } from "@/modules/articles/markdown";
import ui from "@/components/ui.module.css";
import styles from "./bai-viet.module.css";

// Dựng cây Markdown (src/modules/articles/markdown.ts) thành phần tử React: chữ luôn đi qua React (tự thoát), không có HTML thô.

function Inlines({ items }: { items: Inline[] }) {
  return items.map((x, i) => {
    if (x.t === "text") return x.v;
    if (x.t === "strong") return <strong key={i}><Inlines items={x.c} /></strong>;
    if (x.t === "em") return <em key={i}><Inlines items={x.c} /></em>;
    // Link trong site đi qua Link (chuyển trang không tải lại); link ngoài mở bình thường, không gửi trang nguồn.
    return x.href.startsWith("/")
      ? <Link key={i} href={x.href}><Inlines items={x.c} /></Link>
      : <a key={i} href={x.href} rel="noopener noreferrer"><Inlines items={x.c} /></a>;
  });
}

export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case "h":
        return b.level === 2
          ? <h2 key={i} className={`${ui.h2} ${styles.heading}`}><Inlines items={b.c} /></h2>
          : <h3 key={i} className={`${ui.h3} ${styles.heading}`}><Inlines items={b.c} /></h3>;
      case "p":
        return <p key={i}><Inlines items={b.c} /></p>;
      case "ul":
        return <ul key={i} className={styles.list}>{b.items.map((it, k) => <li key={k}><Inlines items={it} /></li>)}</ul>;
      case "ol":
        return <ol key={i} className={styles.list} start={b.start}>{b.items.map((it, k) => <li key={k}><Inlines items={it} /></li>)}</ol>;
      case "quote":
        return <blockquote key={i} className={styles.quote}><ArticleBody blocks={b.c} /></blockquote>;
    }
  });
}
