import type { Metadata } from "next";
import Link from "next/link";
import ui from "@/components/ui.module.css";
import { PAGE_SEO, pageMetadata } from "@/lib/seo";
import { listArticles } from "@/modules/articles/articles";
import { articleDate } from "./article-date";
import styles from "./bai-viet.module.css";

// Danh sách bài viết (content/bai-viet/*.md, mới nhất trước). Dựng sẵn lúc build: bài viết đổi theo commit, không theo dữ liệu.
export const metadata: Metadata = pageMetadata(PAGE_SEO.articles);

export default function ArticlesPage() {
  const articles = listArticles();
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 className={ui.h1}>Bài viết</h1>
        <p className={ui.lead} style={{ maxWidth: 720 }}>Kinh nghiệm phỏng vấn và tiếng Anh buồng máy cho thuyền viên bộ phận máy.</p>
        <ul className={styles.items}>
          {articles.map((a) => (
            <li key={a.slug} className={styles.item}>
              <h2 className={ui.h3}><Link href={a.path}>{a.title}</Link></h2>
              <time className={styles.date} dateTime={a.date}>{articleDate(a.date)}</time>
              <p className={ui.lead}>{a.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
