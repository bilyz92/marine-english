import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { JsonLd } from "@/components/json-ld";
import ui from "@/components/ui.module.css";
import { env } from "@/lib/env";
import { formatVnd } from "@/lib/format";
import { breadcrumbJsonLd, courseAudience, courseDescription, courseJsonLd, metaDescription, pageMetadata } from "@/lib/seo";
import { getPublishedCourse, getPublishedCourseCategory, publishedSlugForUrlSlug } from "@/modules/content/catalog";
import { courseUrl, trialUrl } from "@/modules/content/paths";
import { BuyOrLearn } from "./buy-or-learn";
import { CourseDescription } from "./course-description";
import styles from "./course.module.css";

/**
 * Khóa đang bán theo đường dẫn công khai (/khoa-hoc/<url_slug>), kèm chức danh (danh mục); null khi không bán. Metadata và trang dùng
 * chung một lần đọc trong cùng yêu cầu. Mã nội bộ hay đường dẫn cũ đã được proxy chuyển hướng (src/modules/content/public-urls.ts).
 */
const publishedCourse = cache(async (urlSlug: string) => {
  const slug = await publishedSlugForUrlSlug(urlSlug);
  if (!slug) return null;
  const [course, category] = await Promise.all([getPublishedCourse(slug), getPublishedCourseCategory(slug)]);
  return course ? { ...course, category } : null;
});

/** Tiêu đề, mô tả, canonical theo khóa thật. Khóa không bán (nháp, sắp ra mắt, không có): không trả gì; proxy đã trả 404 thật. */
export async function generateMetadata({ params }: PageProps<"/khoa-hoc/[slug]">): Promise<Metadata> {
  await connection();
  const course = await publishedCourse((await params).slug);
  if (!course) return {};
  return pageMetadata({ title: course.titleVi, description: metaDescription(courseDescription(course)), path: courseUrl(course.urlSlug), ownImage: true });
}

async function Course({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const course = await publishedCourse(slug);
  if (!course) notFound();
  const firstTrial = course.trialLessons[0];
  const origin = env().APP_ORIGIN;
  const description = courseDescription(course);
  const audience = courseAudience(course);
  const crumbs = [{ name: "Trang chủ", path: "/" }, { name: "Khóa học", path: "/khoa-hoc" }, { name: course.titleVi, path: courseUrl(course.urlSlug) }];
  // Chủ 08/11/2026: người chưa mua chỉ thấy module và số bài; trong module chỉ bài học thử hiện tên, còn lại là dòng mờ giả
  // (máy chủ không gửi tên bài thật nên không ai đọc được). Học viên đã mua xem đủ bài trong app học /hoc.
  // Nhóm không có mã ("Nội dung khóa học", "Bài khác") luôn đứng cuối nên số module là thứ tự i + 1.
  return (
    <div className={course.description ? `${styles.layout} ${styles.withAbout}` : styles.layout}>
      <div className={styles.head}>
        <nav aria-label="Đường dẫn" className={styles.crumbs}>
          <ol>
            <li><Link href="/">Trang chủ</Link></li>
            <li><Link href="/khoa-hoc">Khóa học</Link></li>
            <li aria-current="page">{course.titleVi}</li>
          </ol>
        </nav>
        {audience && <span className={ui.chip}>Dành cho: {audience}</span>}
        <h1 className={ui.h1}>{course.titleVi}</h1>
        <p className={ui.lead} lang="en">{course.titleEn}</p>
        {!course.description && <p className={styles.intro}>{description}</p>}
      </div>
      {course.description && <CourseDescription text={course.description} />}
      <section className={`${ui.card} ${styles.main}`} aria-labelledby="h-noi-dung">
        <h2 id="h-noi-dung" className={ui.h3}>Nội dung khóa học ({course.lessonCount} bài)</h2>
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
                    {/* Học viên đọc "Bài 1", không đọc mã nội bộ (mea-ce-001), chủ 17/11/2026. */}
                    <span className={styles.lessonId}>Bài {l.position}</span>
                    <span className={styles.lessonTitle}>{l.title}</span>
                    <Link className={ui.outline} href={trialUrl(course.urlSlug, l.position)}>Học thử</Link>
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
        {firstTrial && <Link className={styles.trial} href={trialUrl(course.urlSlug, firstTrial.position)}>Học thử bài 1</Link>}
        <p className={ui.muted}>Thanh toán bằng VietQR, mọi ngân hàng Việt Nam.</p>
        <p className={ui.muted}>Mỗi tài khoản đăng nhập cùng lúc trên tối đa 2 thiết bị, chạy được cả Android và iPhone.</p>
      </aside>
      <JsonLd data={courseJsonLd(origin, course, description)} />
      <JsonLd data={breadcrumbJsonLd(origin, crumbs)} />
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
