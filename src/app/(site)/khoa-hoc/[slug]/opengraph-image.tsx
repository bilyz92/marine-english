import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatVnd } from "@/lib/format";
import { getPublishedCourse, publishedSlugForUrlSlug } from "@/modules/content/catalog";
import { OG_SIZE, ogCard } from "../../og-card";

export const alt = "Khóa tiếng Anh cho thuyền viên máy – Marine English";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Ảnh chia sẻ riêng từng khóa đang bán (theo đường dẫn công khai): tên, số bài, giá thật. Khóa không bán: 404 như trang khóa. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const slug = await publishedSlugForUrlSlug((await params).slug);
  const course = slug ? await getPublishedCourse(slug) : null;
  if (!course) notFound();
  return ogCard({
    eyebrow: "KHÓA HỌC",
    title: course.titleVi,
    subtitle: course.titleEn,
    footer: `${course.lessonCount} bài · ${formatVnd(course.priceVnd)}${course.trialLessons.length ? ` · học thử ${course.trialLessons.length} bài miễn phí` : ""}`,
  });
}
