import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { LearnerNav } from "@/components/learner-nav";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Marine English", template: "%s · Marine English" },
  description: "Tiếng Anh cho thuyền viên bộ phận máy.",
  // iPhone: icon và tên khi “Thêm vào Màn hình chính”, mở như app riêng.
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Marine English", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#5b21b6" }, { media: "(prefers-color-scheme: dark)", color: "#110e1a" }],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* Chọn Sáng/Tối đã lưu trên máy, đặt trước khi vẽ trang. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* Menu điện thoại của học viên (chỉ hiện khi đã đăng nhập, không hiện ở khu quản trị). */}
        <Suspense fallback={null}><LearnerNav /></Suspense>
      </body>
    </html>
  );
}
