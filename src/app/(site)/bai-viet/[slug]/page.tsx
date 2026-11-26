import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import ui from "@/components/ui.module.css";
import { env } from "@/lib/env";
import { articleJsonLd, breadcrumbJsonLd, pageMetadata, trimDescription } from "@/lib/seo";
import { getArticle, listArticles } from "@/modules/articles/articles";
import { ArticleBody } from "../article-body";
import { articleDate } from "../article-date";
import styles from "../bai-viet.module.css";

// Một bài viết (content/bai-viet/<đường dẫn>.md), dựng sẵn lúc build. Đường dẫn không có bài: proxy trả 404 thật trước khi tới đây.

export function generateStaticParams() {
  return listArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<"/bai-viet/[slug]">): Promise<Metadata> {
  const article = getArticle((await params).slug);
  if (!article) return {};
  const meta = pageMetadata({ title: article.title, description: trimDescription(article.description), path: article.path });
  return { ...meta, openGraph: { ...meta.openGraph, type: "article", publishedTime: article.date } };
}

/** JSON-LD cần APP_ORIGIN lúc chạy (bản build Docker không có biến môi trường). */
async function ArticleData({ path, title, description, date }: { path: string; title: string; description: string; date: string }) {
  await connection();
  const origin = env().APP_ORIGIN;
  const crumbs = [{ name: "Trang chủ", path: "/" }, { name: "Bài viết", path: "/bai-viet" }, { name: title, path }];
  return (
    <>
      <JsonLd data={articleJsonLd(origin, { path, title, description, date })} />
      <JsonLd data={breadcrumbJsonLd(origin, crumbs)} />
    </>
  );
}

export default async function ArticlePage({ params }: PageProps<"/bai-viet/[slug]">) {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  return (
    <main className={ui.section}>
      <article className={`${ui.wrap} ${styles.article}`}>
        <header className={styles.head}>
          <nav aria-label="Đường dẫn" className={styles.crumbs}>
            <ol>
              <li><Link href="/">Trang chủ</Link></li>
              <li><Link href="/bai-viet">Bài viết</Link></li>
            </ol>
          </nav>
          <h1 className={ui.h1}>{article.title}</h1>
          <time className={styles.date} dateTime={article.date}>{articleDate(article.date)}</time>
        </header>
        <ArticleBody blocks={article.blocks} />
      </article>
      <Suspense fallback={null}><ArticleData path={article.path} title={article.title} description={article.description} date={article.date} /></Suspense>
    </main>
  );
}
