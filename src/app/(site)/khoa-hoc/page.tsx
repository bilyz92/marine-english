import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ComingSoon } from "@/components/coming-soon";
import ui from "@/components/ui.module.css";
import { PAGE_SEO, pageMetadata } from "@/lib/seo";
import { listPublishedCatalog } from "@/modules/content/catalog";
import { CategoryTiles, CourseBanner, GroupView } from "./course-groups";
import { CourseCard } from "../course-card";
import { CourseSearch } from "./course-search";

// ?dm=… (một danh mục) và ?tim=1 là cách xem khác của cùng trang: canonical về /khoa-hoc.
export const metadata: Metadata = pageMetadata(PAGE_SEO.courses);

type Search = Promise<{ dm?: string | string[] }>;

/** ?dm=<key> mở một danh mục (key = id danh mục, "khac" là Khóa khác); key không có thì về lưới chức danh. */
async function Courses({ searchParams }: { searchParams: Search }) {
  await connection();
  const [{ courses, groups }, { dm }] = await Promise.all([listPublishedCatalog(), searchParams]);
  if (courses.length === 0) return <ComingSoon />;
  const selected = typeof dm === "string" ? groups.find((g) => g.key === dm) : undefined;
  const onSale = courses.filter((c) => !c.comingSoon);
  return (
    <>
      <p className={ui.lead}>{onSale.length ? "Chọn chức danh của bạn. Học thử các bài đầu trước khi mua." : "Chọn chức danh của bạn. Các khóa đang được hoàn thiện, sắp ra mắt."}</p>
      <CourseSearch courses={courses}>
        {selected ? <GroupView group={selected} /> : (
          <>
            <CategoryTiles groups={groups} />
            {/* Mọi khóa đang bán có link thẳng tới trang khóa ngay trên /khoa-hoc (lưới chức danh chỉ dẫn tới ?dm=…). */}
            {onSale.length > 0 && (
              <section aria-labelledby="h-dang-ban" style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
                <h2 id="h-dang-ban" className={ui.h2}>Khóa đang mở bán</h2>
                <div className={ui.grid}>{onSale.map((c) => <CourseCard key={c.slug} course={c} />)}</div>
              </section>
            )}
          </>
        )}
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
