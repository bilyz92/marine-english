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
  // Chủ 08/11/2026: người chưa mua chỉ thấy module và số bài; trong module chỉ bài học thử hiện tên, còn lại là dòng mờ giả
  // (máy chủ không gửi tên bài thật nên không ai đọc được). Học viên đã mua xem đủ bài trong app học /hoc.
  // Nhóm không có mã ("Nội dung khóa học", "Bài khác") luôn đứng cuối nên số module là thứ tự i + 1.
  return (
    <div className={styles.layout}>
      <div className={styles.head}>
        <p className={ui.muted}><Link href="/khoa-hoc">Khóa học</Link> / Chi tiết khóa</p>
        <h1 className={ui.h1}>{course.titleVi}</h1>
        <p className={ui.lead}>{course.titleEn}</p>
      </div>
      <section className={`${ui.card} ${styles.main}`} aria-label="Danh sách bài">
        <h2 className={ui.h3}>Danh sách bài ({course.lessonCount})</h2>
        {course.modules.map((m, i) => {
          const hidden = m.lessonCount - m.trial.length;
          return (
            <details key={m.id ?? "khac"} className={styles.topic} open={i === 0}>
              <summary>
                {m.id && <span className={styles.topicCode}>Module {i + 1}</span>}
                <span className={styles.topicTitle}>{m.titleVi}<span className={styles.topicCount}>{m.lessonCount} bài</span></span>
              </summary>
              <ol className={styles.lessons}>
                {m.trial.map((l) => (
                  <li key={l.position} className={styles.lesson}>
                    <span className={styles.lessonId}>{l.externalId}</span>
                    <span className={styles.lessonTitle}>{l.title}</span>
                    <Link className={ui.outline} href={`/khoa-hoc/${course.slug}/hoc-thu/${l.position}`}>Học thử</Link>
                  </li>
                ))}
                {Array.from({ length: Math.min(hidden, 4) }, (_, k) => (
                  <li key={`an-${k}`} className={`${styles.lesson} ${styles.locked}`} aria-hidden="true">
                    <span className={styles.lessonId}>•••</span>
                    <span className={styles.lessonTitle}>Bài học trong khóa</span>
                    <span className={ui.muted}>Mở khi mua</span>
                  </li>
                ))}
              </ol>
              {hidden > 0 && <p className={styles.lockedNote}>Mua khóa để mở {hidden} bài{m.trial.length ? " còn lại" : ""}.</p>}
            </details>
          );
        })}
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
