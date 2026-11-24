import Link from "next/link";
import { SITE_INFO } from "@/content/site-info";
import styles from "./coming-soon.module.css";
import ui from "./ui.module.css";

/** Hiện khi chưa có khóa nào đang bán (trang chủ, /khoa-hoc). Liên hệ lấy từ SITE_INFO; chưa có Zalo thì dẫn sang trang Liên hệ. */
export function ComingSoon({ headingId = "h-sap-ra-mat" }: { headingId?: string }) {
  return (
    <div className={styles.box}>
      <h2 id={headingId} className={styles.title}>Sắp ra mắt</h2>
      <p className={`${ui.lead} ${styles.text}`}>Các khóa tiếng Anh cho thuyền viên máy đang được hoàn thiện.</p>
      <p className={styles.text}>{SITE_INFO.zalo ? <>Cần hỏi thêm? Nhắn Zalo: <strong>{SITE_INFO.zalo}</strong></> : "Cần hỏi thêm? Liên hệ với chúng tôi."}</p>
      <div className={`${ui.row} ${styles.actions}`}><Link className={ui.action} href="/lien-he">Liên hệ</Link></div>
    </div>
  );
}
