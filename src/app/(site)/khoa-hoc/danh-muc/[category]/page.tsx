import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { JsonLd } from "@/components/json-ld";
import ui from "@/components/ui.module.css";
import { env } from "@/lib/env";
import { breadcrumbJsonLd, categoryDescription, categoryTitle, pageMetadata } from "@/lib/seo";
import { catalogGroupBySlug, listPublishedCatalog } from "@/modules/content/catalog";
import { categoryUrl } from "@/modules/content/paths";
import { CourseBanner, GroupView, groupName } from "../../course-groups";
import { CourseSearch } from "../../course-search";

// Trang một danh mục (chức danh), danh mục con hoặc "Khóa khác" (SEO, chủ 26/11/2026): thay cho /khoa-hoc?dm=<id>. Danh mục không có
// hay không có khóa nào hiện được: proxy đã trả 404 thật (src/modules/content/public-urls.ts); notFound() ở đây chỉ để phòng dữ liệu
// đổi giữa chừng.

const catalogView = cache(async (urlSlug: string) => {
  const catalog = await listPublishedCatalog();
  return { ...catalog, group: catalogGroupBySlug(catalog.groups, urlSlug) };
});

export async function generateMetadata({ params }: PageProps<"/khoa-hoc/danh-muc/[category]">): Promise<Metadata> {
  await connection();
  const { group } = await catalogView((await params).category);
  if (!group) return {};
  return pageMetadata({ title: categoryTitle(group), description: categoryDescription(group), path: categoryUrl(group.urlSlug) });
}

async function Category({ params }: { params: Promise<{ category: string }> }) {
  await connection();
  const { courses, group } = await catalogView((await params).category);
  if (!group) notFound();
  const crumbs = [{ name: "Trang chủ", path: "/" }, { name: "Khóa học", path: "/khoa-hoc" }, { name: groupName(group), path: categoryUrl(group.urlSlug) }];
  return (
    <>
      <CourseSearch courses={courses}>
        <GroupView group={group} />
      </CourseSearch>
      <JsonLd data={breadcrumbJsonLd(env().APP_ORIGIN, crumbs)} />
    </>
  );
}

export default function CategoryPage({ params }: PageProps<"/khoa-hoc/danh-muc/[category]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <CourseBanner heading={false} />
        <Suspense fallback={<p className={ui.muted}>Đang tải danh sách khóa…</p>}><Category params={params} /></Suspense>
      </div>
    </main>
  );
}
