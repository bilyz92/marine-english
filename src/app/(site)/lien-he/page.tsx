import type { Metadata } from "next";
import Link from "next/link";
import ui from "@/components/ui.module.css";
import { SITE_INFO } from "@/content/site-info";

export const metadata: Metadata = { title: "Liên hệ" };

const CHANNELS = [
  { title: "Zalo", text: "Nhóm hỗ trợ học viên.", value: SITE_INFO.zalo },
  { title: "Messenger", text: "Nhắn trang Facebook của khóa học.", value: SITE_INFO.messenger },
  { title: "Email", text: "Phù hợp cho yêu cầu hoàn tiền, xem, sửa hoặc xóa dữ liệu.", value: SITE_INFO.email },
];

export default function ContactPage() {
  return (
    <main className={ui.section}>
      <div className={ui.wrap}>
        <h1 className={ui.h1}>Liên hệ</h1>
        <p className={ui.lead}>Hỏi về khóa học, thanh toán, hoàn tiền hoặc dữ liệu cá nhân. Người soạn bài thường đang trên tàu; người hỗ trợ trên bờ trả lời trong giờ làm việc.</p>
        <div className={ui.grid} style={{ marginTop: 24 }}>
          {CHANNELS.map((c) => (
            <section key={c.title} className={ui.card}>
              <h2 className={ui.h3}>{c.title}</h2>
              <p className={ui.lead}>{c.text}</p>
              <p className={c.value ? undefined : ui.muted}>{c.value ?? "Đang cập nhật"}</p>
            </section>
          ))}
        </div>
        <section className={ui.card} style={{ marginTop: 20 }}>
          <h2 className={ui.h3}>Tự xử lý nhanh</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Chuyển khoản rồi mà chưa mở khóa: đừng chuyển lại. Bấm “Mua khóa” lần nữa, trang sẽ hiện đơn trước để xem trạng thái.</li>
            <li>Muốn hoàn tiền: xem <Link href="/chinh-sach?tab=hoan-tien">chính sách hoàn tiền</Link>.</li>
            <li>Đổi cách đăng nhập, gỡ thiết bị: vào <Link href="/tai-khoan">Tài khoản của tôi</Link>.</li>
          </ul>
          <p className={ui.muted}>Khi gửi tin, không cần gửi hộ chiếu, căn cước hay ảnh thẻ ngân hàng.</p>
        </section>
      </div>
    </main>
  );
}
