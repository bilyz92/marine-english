import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { LearnerNav } from "@/components/learner-nav";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Marine English", template: "%s · Marine English" },
  description: "Tiếng Anh cho thuyền viên bộ phận máy.",
  // iPhone: icon và tên khi “Thêm vào Màn hình chính”, mở như app riêng.
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Marine English", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#5b21b6" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={beVietnam.variable}>
      <body>
        {children}
        {/* Menu điện thoại của học viên (chỉ hiện khi đã đăng nhập, không hiện ở khu quản trị). */}
        <Suspense fallback={null}><LearnerNav /></Suspense>
      </body>
    </html>
  );
}
