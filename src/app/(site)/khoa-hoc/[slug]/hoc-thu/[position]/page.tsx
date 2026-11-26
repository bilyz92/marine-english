import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LessonBody, type LessonContent } from "@/components/lesson-body";
import { LessonStudy } from "@/components/study/lesson-study";
import { EssayLesson } from "@/components/study/essay-lesson";
import { InterviewLessonView } from "@/components/study/interview-lesson";
import { isInterview } from "@/lib/study/interview";
import { VideoLesson, type VideoContent } from "@/components/study/video-lesson";
import { hasLevels, type StudyLesson } from "@/lib/study/levels";
import { GUEST } from "@/lib/study/storage";
import ui from "@/components/ui.module.css";
import { BuyOrLearn } from "../../buy-or-learn";
import { getPublishedCourse, getTrialLesson, publishedSlugForUrlSlug } from "@/modules/content/catalog";
import { courseUrl, trialUrl } from "@/modules/content/paths";
import { metaDescription, pageMetadata } from "@/lib/seo";
import { trialVideo } from "@/modules/content/lesson-video";

/** Khóa đang bán theo đường dẫn công khai (`[slug]` là url_slug; mã nội bộ đã được proxy chuyển hướng). */
const publishedCourse = cache(async (urlSlug: string) => {
  const slug = await publishedSlugForUrlSlug(urlSlug);
  return slug ? getPublishedCourse(slug) : null;
});

/** Bài học thử của khóa đang bán: tên khóa và tiêu đề bài thật. Bài không phải bài thử hay khóa không bán: không trả gì; proxy đã trả 404. */
async function trialInfo(urlSlug: string, position: string) {
  const course = await publishedCourse(urlSlug);
  const trial = course?.trialLessons.find((t) => String(t.position) === position);
  return course && trial ? { course, trial } : null;
}

export async function generateMetadata({ params }: PageProps<"/khoa-hoc/[slug]/hoc-thu/[position]">): Promise<Metadata> {
  await connection();
  const { slug, position } = await params;
  const info = await trialInfo(slug, position);
  if (!info) return {};
  const { course, trial } = info;
  return pageMetadata({
    title: `Học thử bài ${trial.position}: ${course.titleVi}`,
    description: metaDescription(`Bài ${trial.position} học thử miễn phí của khóa ${course.titleVi} (${course.titleEn}): ${trial.title}. Học ngay trên điện thoại, không cần tài khoản.`),
    path: trialUrl(course.urlSlug, trial.position),
  });
}

async function Trial({ params }: { params: Promise<{ slug: string; position: string }> }) {
  await connection();
  const { slug: urlSlug, position } = await params;
  const info = await trialInfo(urlSlug, position);
  if (!info) notFound();
  const slug = info.course.slug; // mã nội bộ: video học thử, nút mua
  // getTrialLesson chỉ trả bài thử của khóa đang mở bán; bài khác hay vị trí sai đều 404.
  const lesson = await getTrialLesson(slug, Number(position));
  if (!lesson) notFound();
  return (
    <>
      <h1 className={ui.h2}>{`Học thử bài ${info.trial.position}: ${info.course.titleVi}`}</h1>
      {(lesson.content as { lesson_type?: string }).lesson_type === "video"
        ? <VideoLesson
            externalId={lesson.externalId} content={lesson.content as VideoContent}
            video={{ src: (await trialVideo(slug, Number(position))) ? `/api/public/courses/${encodeURIComponent(slug)}/trial/${Number(position)}/video` : null }}
          />
        : isInterview(lesson.content)
        ? <InterviewLessonView lesson={lesson.content} who={GUEST} />
        : (lesson.content as { lesson_type?: string }).lesson_type === "essay"
        ? <EssayLesson externalId={lesson.externalId} content={lesson.content as LessonContent} who={GUEST} />
        : hasLevels(lesson.content as StudyLesson)
        ? <LessonStudy externalId={lesson.externalId} lesson={lesson.content as StudyLesson} who={GUEST} />
        : <LessonBody externalId={lesson.externalId} content={lesson.content as LessonContent} />}
      <div className={ui.row}>
        <BuyOrLearn slug={slug} />
        <Link className={ui.outline} href={courseUrl(info.course.urlSlug)}>← Danh sách bài</Link>
      </div>
    </>
  );
}

export default function TrialPage({ params }: PageProps<"/khoa-hoc/[slug]/hoc-thu/[position]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 1080, display: "flex", flexDirection: "column", gap: 14 }}>
        <Suspense fallback={<p className={ui.muted}>Đang mở bài…</p>}><Trial params={params} /></Suspense>
      </div>
    </main>
  );
}
