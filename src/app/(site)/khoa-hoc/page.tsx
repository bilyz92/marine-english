import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ComingSoon } from "@/components/coming-soon";
import ui from "@/components/ui.module.css";
import { listPublishedCatalog } from "@/modules/content/catalog";
import { CategoryTiles, CourseBanner, GroupView } from "./course-groups";
import { CourseSearch } from "./course-search";

export const metadata: Metadata = { title: "Khóa học" };

type Search = Promise<{ dm?: string | string[] }>;

/** ?dm=<key> mở một danh mục (key = id danh mục, "khac" là Khóa khác); key không có thì về lưới chức danh. */
async function Courses({ searchParams }: { searchParams: Search }) {
  await connection();
  const [{ courses, groups }, { dm }] = await Promise.all([listPublishedCatalog(), searchParams]);
  if (courses.length === 0) return <ComingSoon />;
  const selected = typeof dm === "string" ? groups.find((g) => g.key === dm) : undefined;
  return (
    <>
      <p className={ui.lead}>{courses.some((c) => !c.comingSoon) ? "Chọn chức danh của bạn. Học thử các bài đầu trước khi mua." : "Chọn chức danh của bạn. Các khóa đang được hoàn thiện, sắp ra mắt."}</p>
      <CourseSearch courses={courses}>
        {selected ? <GroupView group={selected} /> : <CategoryTiles groups={groups} />}
      </CourseSearch>
    </>
  );
}

export default function CatalogPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <CourseBanner />
        <Suspense fallback={<p className={ui.muted}>Đang tải danh sách khóa…</p>}><Courses searchParams={searchParams} /></Suspense>
      </div>
    </main>
  );
}
