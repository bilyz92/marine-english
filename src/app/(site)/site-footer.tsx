import Link from "next/link";
import { REFUNDS_UI } from "@/lib/features";
import ui from "@/components/ui.module.css";
import styles from "./site.module.css";

// Tên hộ kinh doanh, địa chỉ, mã số thuế chờ chủ dự án cung cấp (docs/noi-dung-can-chu-du-an.md): chưa có thì không hiện.
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${ui.wrap} ${styles.footerRow}`}>
        <strong>Marine English</strong>
        <nav aria-label="Liên kết cuối trang" className={styles.footerNav}>
          <Link href="/chinh-sach?tab=bao-mat">Chính sách bảo mật</Link>
          <Link href="/chinh-sach?tab=dieu-khoan">Điều khoản sử dụng</Link>
          {REFUNDS_UI && <Link href="/chinh-sach?tab=hoan-tien">Chính sách hoàn tiền</Link>}
          <Link href="/lien-he">Liên hệ</Link>
        </nav>
      </div>
    </footer>
  );
}
