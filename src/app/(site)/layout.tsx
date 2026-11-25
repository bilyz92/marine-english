import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * Địa chỉ gốc cho canonical, og:url, og:image của site công khai: APP_ORIGIN đọc lúc chạy (bản build Docker không có biến môi
 * trường, không đóng băng localhost vào trang).
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { metadataBase: new URL(env().APP_ORIGIN) };
}

// Báo cho Next biết mọi trang site có phần dựng theo yêu cầu (metadata ở trên); phần còn lại của trang vẫn dựng sẵn được.
async function RequestTime() {
  await connection();
  return null;
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
      <Suspense fallback={null}><RequestTime /></Suspense>
    </>
  );
}
