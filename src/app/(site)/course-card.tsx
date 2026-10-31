import Link from "next/link";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import type { CourseCard as Course } from "@/modules/content/catalog";

export function CourseCard({ course }: { course: Course }) {
  return (
    <article className={ui.card}>
      <h3 className={ui.h3}>{course.titleVi}</h3>
      <p className={ui.lead}>{course.titleEn}</p>
      <span className={ui.muted}>{course.lessonCount} bài · {course.trialLessons.length} bài học thử</span>
      <span className={ui.price}>{formatVnd(course.priceVnd)}</span>
      <div className={ui.row}>
        <Link className={ui.action} href={`/mua/${course.slug}`}>Mua khóa</Link>
        <Link className={ui.outline} href={`/khoa-hoc/${course.slug}`}>Xem chi tiết</Link>
      </div>
    </article>
  );
}
