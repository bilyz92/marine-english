import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import { getPublishedCourse } from "@/modules/content/catalog";
import { BuyOrLearn } from "./buy-or-learn";
import styles from "./course.module.css";

export const metadata: Metadata = { title: "Chi tiết khóa học" };

async function Course({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();
  const firstTrial = course.trialLessons[0];
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <h1 className={ui.h1}>{course.titleVi}</h1>
        <p className={ui.lead}>{course.titleEn}</p>
        <h2 className={ui.h2}>Danh sách bài ({course.lessonCount})</h2>
        <ol className={styles.lessons}>
          {course.lessons.map((l) => (
            <li key={l.position} className={styles.lesson}>
              <span>{l.title}</span>
              {l.isFreeTrial
                ? <Link className={ui.outline} href={`/khoa-hoc/${course.slug}/hoc-thu/${l.position}`}>Học thử</Link>
                : <span className={ui.muted}>Mở khi mua</span>}
            </li>
          ))}
        </ol>
      </div>
      <aside className={`${ui.card} ${styles.buy}`}>
        <span className={ui.price}>{formatVnd(course.priceVnd)}</span>
        <BuyOrLearn slug={course.slug} />
        {firstTrial && <Link className={ui.outline} href={`/khoa-hoc/${course.slug}/hoc-thu/${firstTrial.position}`}>Học thử bài 1</Link>}
      </aside>
    </div>
  );
}

export default function CoursePage({ params }: PageProps<"/khoa-hoc/[slug]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap}>
        <Suspense fallback={<p className={ui.muted}>Đang tải khóa học…</p>}><Course params={params} /></Suspense>
      </div>
    </main>
  );
}
