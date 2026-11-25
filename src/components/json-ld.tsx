import { jsonLdHtml } from "@/lib/seo";

/** Dữ liệu có cấu trúc schema.org; chuỗi đã thoát < > & nên tên khóa từ DB không đóng được thẻ script. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />;
}
