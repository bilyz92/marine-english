import type { Metadata } from "next";
import Link from "next/link";
import ui from "@/components/ui.module.css";
import { ABOUT, ABOUT_CTA } from "@/content/about";
import styles from "./about.module.css";

export const metadata: Metadata = { title: "Câu chuyện người sáng lập" };

export default function AboutPage() {
  const last = ABOUT.length - 1;
  return (
    <main className={ui.section}>
      <article className={`${ui.wrap} ${styles.article}`}>
        {ABOUT.map((block, i) => {
          if (block.kind === "h1") return <h1 key={i} className={ui.h1}>{block.text}</h1>;
          if (block.kind === "h2") return <h2 key={i} className={ui.h2}>{block.text}</h2>;
          if (block.kind === "blockquote") return <blockquote key={i} className={styles.quote}>{block.text}</blockquote>;
          // Thông điệp và lưu ý cuối bài có nền nhấn để hiện rõ (spec WEB-10).
          if (i === last) return <p key={i} className={ui.notice}>{block.text}</p>;
          if (i === last - 1) return <p key={i} className={styles.message}>{block.text}</p>;
          return <p key={i}>{block.text}</p>;
        })}
        <div className={styles.contact}>
          <h2 className={ui.h3}>{ABOUT_CTA.title}</h2>
          <p>{ABOUT_CTA.text}</p>
          <div className={ui.row}>
            <Link className={ui.action} href="/khoa-hoc">Xem các khóa học</Link>
            <Link className={ui.outline} href="/lien-he">Liên hệ</Link>
          </div>
        </div>
      </article>
    </main>
  );
}
