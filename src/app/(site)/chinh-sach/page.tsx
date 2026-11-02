import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { REFUNDS_UI } from "@/lib/features";
import ui from "@/components/ui.module.css";
import styles from "./policies.module.css";

export const metadata: Metadata = { title: "Chính sách" };

const ALL_TABS = [
  { id: "bao-mat", label: "Bảo mật" },
  { id: "hoan-tien", label: "Hoàn tiền" },
  { id: "dieu-khoan", label: "Điều khoản" },
] as const;
// Hoàn tiền đang ẩn (src/lib/features.ts).
const TABS = ALL_TABS.filter((t) => REFUNDS_UI || t.id !== "hoan-tien");

// Văn bản pháp lý, thời hạn lưu, mức hoàn tiền chờ chủ dự án duyệt: chỉ đăng phần là sự thật về hệ thống, còn lại “Đang cập nhật”.
function Pending() {
  return <p className={ui.notice}>Đang cập nhật. Văn bản chính thức sẽ đăng sau khi được duyệt.</p>;
}

function Privacy() {
  return (
    <>
      <h2 className={ui.h2}>Chính sách bảo mật</h2>
      <h3 className={ui.h3}>Thông tin thu khi tạo tài khoản</h3>
      <p>Tên hiển thị, một cách liên hệ (email hoặc số điện thoại), chức danh (không bắt buộc).</p>
      <h3 className={ui.h3}>Các bên xử lý dữ liệu</h3>
      <ul>
        <li>SePay: đọc giao dịch của tài khoản ngân hàng nhận tiền, để xác nhận đơn hàng.</li>
        <li>Dịch vụ email: gửi mã đăng nhập và thông báo đơn hàng.</li>
        <li>Zalo: gửi mã đăng nhập nếu bạn chọn đăng nhập bằng số điện thoại.</li>
      </ul>
      <h3 className={ui.h3}>Học offline</h3>
      <p>Nội dung đã tải về máy không bị thu hồi ngay khi máy chưa có mạng. Giấy phép học offline có hạn 30 ngày, thêm 7 ngày ân hạn, và tự gia hạn mỗi lần đồng bộ.</p>
      <Pending />
    </>
  );
}

function Refund() {
  return (
    <>
      <h2 className={ui.h2}>Chính sách hoàn tiền</h2>
      <ul>
        <li>Khi hoàn tiền, quyền học khóa đó được thu hồi cùng lúc; tiến độ học được giữ nếu bạn mua lại.</li>
        <li>Chuyển khoản sai số tiền hoặc sai nội dung: khoản tiền được chuyển sang xử lý tay.</li>
      </ul>
      <Pending />
    </>
  );
}

function Terms() {
  return (
    <>
      <h2 className={ui.h2}>Điều khoản sử dụng</h2>
      <ul>
        <li>Mỗi tài khoản đăng nhập cùng lúc tối đa 2 thiết bị.</li>
      </ul>
      <Pending />
    </>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active = TABS.some((t) => t.id === tab) ? tab : "bao-mat";
  return (
    <>
      <nav aria-label="Các chính sách" className={styles.tabs}>
        {TABS.map((t) => (
          <Link key={t.id} href={`/chinh-sach?tab=${t.id}`} className={t.id === active ? styles.tabActive : styles.tab} aria-current={t.id === active ? "page" : undefined}>{t.label}</Link>
        ))}
      </nav>
      {active === "bao-mat" && <Privacy />}
      {REFUNDS_UI && active === "hoan-tien" && <Refund />}
      {active === "dieu-khoan" && <Terms />}
    </>
  );
}

export default function PoliciesPage({ searchParams }: PageProps<"/chinh-sach">) {
  return (
    <main className={ui.section}>
      <div className={`${ui.wrap} ${styles.page}`}>
        <h1 className={ui.h1}>Chính sách</h1>
        <Suspense><Content searchParams={searchParams as Promise<{ tab?: string }>} /></Suspense>
      </div>
    </main>
  );
}
