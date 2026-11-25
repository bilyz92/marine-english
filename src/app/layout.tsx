import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { LearnerNav } from "@/components/learner-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Marine English", template: "%s · Marine English" },
  description: "Tiếng Anh cho thuyền viên bộ phận máy.",
  // Mặc định khi chia sẻ; trang công khai ghi đè tiêu đề, mô tả, canonical (src/lib/seo.ts). Địa chỉ gốc đặt ở app/(site)/layout.tsx.
  openGraph: { type: "website", locale: "vi_VN", siteName: "Marine English" },
  twitter: { card: "summary_large_image" },
  // iPhone: icon và tên khi “Thêm vào Màn hình chính”, mở như app riêng.
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Marine English", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#5b21b6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi">
      <body>
        {children}
        {/* Menu điện thoại của học viên (chỉ hiện khi đã đăng nhập, không hiện ở khu quản trị). */}
        <Suspense fallback={null}><LearnerNav /></Suspense>
      </body>
    </html>
  );
}
