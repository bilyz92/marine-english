import Link from "next/link";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import type { CatalogCourseCard as Course } from "@/modules/content/catalog";
import { CourseCardAction } from "./course-card-action";
import styles from "./course-card.module.css";

export function CourseCard({ course }: { course: Course }) {
  if (course.comingSoon || course.priceVnd === null) {
    return (
      <article className={`${ui.card} ${styles.soon}`}>
        <div className={styles.soonBody}>
          <h3 className={ui.h3}>{course.titleVi}</h3>
          <p className={ui.lead}>{course.titleEn}</p>
          <span className={ui.muted}>{course.lessonCount} bài</span>
        </div>
        <span className={styles.soonLabel}>Sắp ra mắt</span>
      </article>
    );
  }
  return (
    <article className={ui.card}>
      <h3 className={ui.h3}>{course.titleVi}</h3>
      <p className={ui.lead}>{course.titleEn}</p>
      <span className={ui.muted}>{course.lessonCount} bài · {course.trialLessons.length} bài học thử</span>
      <span className={ui.price}>{formatVnd(course.priceVnd)}</span>
      <div className={ui.row}>
        <CourseCardAction slug={course.slug} />
        <Link className={ui.outline} href={`/khoa-hoc/${course.slug}`}>Xem chi tiết</Link>
      </div>
    </article>
  );
}
