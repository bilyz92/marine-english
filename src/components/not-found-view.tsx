import Link from "next/link";
import ui from "./ui.module.css";

/** Trang không tồn tại, dùng chung cho cả site. */
export function NotFoundView() {
  return (
    <main className={ui.section}>
      <div className={ui.wrap} style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className={ui.h2}>Không tìm thấy trang này</h1>
        <p className={ui.lead}>Đường dẫn có thể đã đổi, hoặc khóa học này chưa mở bán.</p>
        <div className={ui.row}>
          <Link className={ui.primary} href="/khoa-hoc">Xem các khóa học</Link>
          <Link className={ui.outline} href="/">Về trang chủ</Link>
        </div>
      </div>
    </main>
  );
}
