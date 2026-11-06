import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import { getPublishedCourse, type LessonSummary } from "@/modules/content/catalog";
import { groupByTopic } from "@/lib/offline/topics";
import { BuyOrLearn } from "./buy-or-learn";
import styles from "./course.module.css";

export const metadata: Metadata = { title: "Chi tiết khóa học" };

async function Course({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();
  const firstTrial = course.trialLessons[0];
  // Giao diện v2: bài chia theo chủ đề (gập mở được, chủ đề đầu mở sẵn); khóa không có chủ đề thì danh sách phẳng.
  const groups = groupByTopic(course.topics, course.lessons.map((l) => ({ ...l, status: null })));
  const row = (l: LessonSummary) => (
    <li key={l.position} className={styles.lesson}>
      <span className={styles.lessonId}>{l.externalId}</span>
      <span className={styles.lessonTitle}>{l.title}</span>
      {l.isFreeTrial
        ? <Link className={ui.outline} href={`/khoa-hoc/${course.slug}/hoc-thu/${l.position}`}>Học thử</Link>
        : <span className={ui.muted}>Mở khi mua</span>}
    </li>
  );
  return (
    <div className={styles.layout}>
      <div className={styles.head}>
        <p className={ui.muted}><Link href="/khoa-hoc">Khóa học</Link> / Chi tiết khóa</p>
        <h1 className={ui.h1}>{course.titleVi}</h1>
        <p className={ui.lead}>{course.titleEn}</p>
      </div>
      <section className={`${ui.card} ${styles.main}`} aria-label="Danh sách bài">
        <h2 className={ui.h3}>Danh sách bài ({course.lessonCount})</h2>
        {groups ? groups.map((g) => (
          <details key={g.id ?? "khac"} className={styles.topic} open={g.open}>
            <summary>
              {g.id && <span className={styles.topicCode}>{g.id}</span>}
              <span className={styles.topicTitle}>{g.titleVi}<span className={styles.topicCount}>{g.lessons.length} bài</span></span>
            </summary>
            <ol className={styles.lessons}>{g.lessons.map(row)}</ol>
          </details>
        )) : <ol className={styles.lessons}>{course.lessons.map(row)}</ol>}
      </section>
      <aside className={`${ui.plate} ${styles.buy}`}>
        <span className={ui.price}>{formatVnd(course.priceVnd)}</span>
        <BuyOrLearn slug={course.slug} />
        {firstTrial && <Link className={styles.trial} href={`/khoa-hoc/${course.slug}/hoc-thu/${firstTrial.position}`}>Học thử bài 1</Link>}
        <p className={ui.muted}>Thanh toán bằng VietQR, mọi ngân hàng Việt Nam.</p>
        <p className={ui.muted}>Mỗi tài khoản đăng nhập cùng lúc trên tối đa 2 thiết bị, chạy được cả Android và iPhone.</p>
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
