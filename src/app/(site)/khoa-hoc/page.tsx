import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { listPublishedCourses } from "@/modules/content/catalog";
import { CourseSearch } from "./course-search";

export const metadata: Metadata = { title: "Khóa học" };

async function Courses() {
  await connection();
  const courses = await listPublishedCourses();
  if (courses.length === 0) return <p className={ui.notice}>Các khóa học sắp ra mắt.</p>;
  return <CourseSearch courses={courses} />;
}

export default function CatalogPage() {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 className={ui.h1}>Khóa học</h1>
        <p className={ui.lead}>Học thử các bài đầu trước khi mua.</p>
        <Suspense fallback={<p className={ui.muted}>Đang tải danh sách khóa…</p>}><Courses /></Suspense>
      </div>
    </main>
  );
}
