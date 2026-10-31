import { Suspense } from "react";
import { LearnApp } from "./learn-app";

// Một vỏ trang tĩnh cho toàn bộ app học (khóa, bài chọn bằng tham số URL), để service worker lưu một trang là mở được khi mất mạng.
export default function LearnPage() {
  return (
    <Suspense>
      <LearnApp />
    </Suspense>
  );
}
