import type { Metadata } from "next";
import { Suspense } from "react";
import { LearnApp } from "./learn-app";

export const metadata: Metadata = { title: "Khóa của tôi", robots: { index: false } };

// Một vỏ trang tĩnh cho toàn bộ app học (khóa, bài chọn bằng tham số URL), để service worker lưu một trang là mở được khi mất mạng.
export default function LearnPage() {
  return (
    <Suspense>
      <LearnApp />
    </Suspense>
  );
}
