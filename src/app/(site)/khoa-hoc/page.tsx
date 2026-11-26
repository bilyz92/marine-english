import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ComingSoon } from "@/components/coming-soon";
import ui from "@/components/ui.module.css";
import { PAGE_SEO, pageMetadata } from "@/lib/seo";
import { listPublishedCatalog } from "@/modules/content/catalog";
import { CategoryTiles, CourseBanner } from "./course-groups";
import { CourseCard } from "../course-card";
import { CourseSearch } from "./course-search";

// ?tim=1 là cách xem khác của cùng trang: canonical về /khoa-hoc. Một danh mục có trang riêng /khoa-hoc/danh-muc/<đường dẫn>;
// ?dm=<id> cũ được proxy chuyển hướng vĩnh viễn tới đó (src/modules/content/public-urls.ts).
export const metadata: Metadata = pageMetadata(PAGE_SEO.courses);

async function Courses() {
  await connection();
  const { courses, groups } = await listPublishedCatalog();
  if (courses.length === 0) return <ComingSoon />;
  const onSale = courses.filter((c) => !c.comingSoon);
  return (
    <>
      <p className={ui.lead}>{onSale.length ? "Chọn chức danh của bạn. Học thử các bài đầu trước khi mua." : "Chọn chức danh của bạn. Các khóa đang được hoàn thiện, sắp ra mắt."}</p>
      <CourseSearch courses={courses}>
        <CategoryTiles groups={groups} />
        {/* Mọi khóa đang bán có link thẳng tới trang khóa ngay trên /khoa-hoc (lưới chức danh dẫn tới trang danh mục). */}
        {onSale.length > 0 && (
          <section aria-labelledby="h-dang-ban" style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <h2 id="h-dang-ban" className={ui.h2}>Khóa đang mở bán</h2>
            <div className={ui.grid}>{onSale.map((c) => <CourseCard key={c.slug} course={c} />)}</div>
          </section>
        )}
      </CourseSearch>
    </>
  );
}

export default function CatalogPage() {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <CourseBanner />
        <Suspense fallback={<p className={ui.muted}>Đang tải danh sách khóa…</p>}><Courses /></Suspense>
      </div>
    </main>
  );
}
