import type { Metadata } from "next";
import { Suspense } from "react";
import ui from "@/components/ui.module.css";
import { Checkout } from "./checkout";

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false } };

async function Load({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Checkout code={code} />;
}

export default function CheckoutPage({ params }: PageProps<"/thanh-toan/[code]">) {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <Suspense fallback={<p className={ui.muted}>Đang tải đơn…</p>}><Load params={params} /></Suspense>
      </div>
    </main>
  );
}
