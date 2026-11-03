import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { getPublishedCourse } from "@/modules/content/catalog";
import { env } from "@/lib/env";
import { paymentInfo, sepayEnabled } from "@/modules/orders/payment-info";
import { REFUNDS_UI } from "@/lib/features";
import { BuyForm } from "./buy-form";
import styles from "./buy.module.css";

export const metadata: Metadata = { title: "Thông tin người mua", robots: { index: false } };

async function Buy({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();
  if (!paymentInfo()) {
    return (
      <>
        <h1 className={ui.h2}>Thông tin người mua</h1>
        <p className={ui.notice}>Chưa mở thanh toán cho khóa học này. Vui lòng quay lại sau.</p>
      </>
    );
  }
  return (
    <BuyForm slug={course.slug} titleVi={course.titleVi} priceVnd={course.priceVnd} lessonCount={course.lessonCount}
      refundPolicy={REFUNDS_UI} autoConfirm={sepayEnabled(env())} />
  );
}

export default function BuyPage({ params }: PageProps<"/mua/[slug]">) {
  return (
    <main className={`${ui.section} ${styles.page}`}>
      <div className={ui.wrap} style={{ maxWidth: 1040 }}>
        <ol className={styles.steps} aria-label="Các bước mua">
          <li className={`${styles.step} ${styles.stepNow}`} aria-current="step">1 · Thông tin</li>
          <li className={styles.step}>2 · Quét VietQR</li>
          <li className={styles.step}>3 · Vào học</li>
        </ol>
        <Suspense fallback={<p className={ui.muted}>Đang tải…</p>}><Buy params={params} /></Suspense>
      </div>
    </main>
  );
}
