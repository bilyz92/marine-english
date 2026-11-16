import type { Metadata } from "next";
import { Suspense } from "react";
import ui from "@/components/ui.module.css";
import { Checkout } from "../../thanh-toan/[code]/checkout";

// Trang đơn của khách chưa có tài khoản (chủ 16/11/2026): công khai, dữ liệu chỉ trả khi trình duyệt có cookie của đơn này.

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false } };

async function Load({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Checkout code={code} guest />;
}

export default function GuestOrderPage({ params }: PageProps<"/don-hang/[code]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <Suspense fallback={<p className={ui.muted}>Đang tải đơn…</p>}><Load params={params} /></Suspense>
      </div>
    </main>
  );
}
