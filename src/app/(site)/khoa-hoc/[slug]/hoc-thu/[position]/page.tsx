import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LessonBody, type LessonContent } from "@/components/lesson-body";
import { LessonStudy } from "@/components/study/lesson-study";
import { hasLevels, type StudyLesson } from "@/lib/study/levels";
import { GUEST } from "@/lib/study/storage";
import ui from "@/components/ui.module.css";
import { BuyOrLearn } from "../../buy-or-learn";
import { getTrialLesson } from "@/modules/content/catalog";

export const metadata: Metadata = { title: "Học thử" };

async function Trial({ params }: { params: Promise<{ slug: string; position: string }> }) {
  await connection();
  const { slug, position } = await params;
  // getTrialLesson chỉ trả bài thử của khóa đang mở bán; bài khác hay vị trí sai đều 404.
  const lesson = await getTrialLesson(slug, Number(position));
  if (!lesson) notFound();
  return (
    <>
      {hasLevels(lesson.content as StudyLesson)
        ? <LessonStudy externalId={lesson.externalId} lesson={lesson.content as StudyLesson} who={GUEST} />
        : <LessonBody externalId={lesson.externalId} content={lesson.content as LessonContent} />}
      <div className={ui.row}>
        <BuyOrLearn slug={slug} />
        <Link className={ui.outline} href={`/khoa-hoc/${slug}`}>← Danh sách bài</Link>
      </div>
    </>
  );
}

export default function TrialPage({ params }: PageProps<"/khoa-hoc/[slug]/hoc-thu/[position]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 className={ui.h2}>Bài học thử</h1>
        <Suspense fallback={<p className={ui.muted}>Đang mở bài…</p>}><Trial params={params} /></Suspense>
      </div>
    </main>
  );
}
