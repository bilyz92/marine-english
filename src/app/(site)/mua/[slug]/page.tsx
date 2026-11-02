import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { getPublishedCourse } from "@/modules/content/catalog";
import { paymentInfo } from "@/modules/orders/payment-info";
import { REFUNDS_UI } from "@/lib/features";
import { BuyForm } from "./buy-form";

export const metadata: Metadata = { title: "Thông tin người mua", robots: { index: false } };

async function Buy({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();
  if (!paymentInfo()) return <p className={ui.notice}>Chưa mở thanh toán cho khóa học này. Vui lòng quay lại sau.</p>;
  return <BuyForm slug={course.slug} titleVi={course.titleVi} priceVnd={course.priceVnd} refundPolicy={REFUNDS_UI} />;
}

export default function BuyPage({ params }: PageProps<"/mua/[slug]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className={ui.h2}>Thông tin người mua</h1>
        <p className={ui.muted}>Bước 1 / 3: Thông tin → Thanh toán → Vào học</p>
        <Suspense fallback={<p className={ui.muted}>Đang tải…</p>}><Buy params={params} /></Suspense>
      </div>
    </main>
  );
}
