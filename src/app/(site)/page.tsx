import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import ui from "@/components/ui.module.css";
import { listPublishedCourses } from "@/modules/content/catalog";
import { CourseCard } from "./course-card";
import styles from "./home.module.css";

// WEB-01 từ Home.dc.html, sửa theo Spec mục 10. Các câu chưa đúng với sản phẩm hiện tại đã bỏ: xem docs/noi-dung-can-chu-du-an.md.

const BENEFITS = [
  { title: "Đúng tình huống buồng máy", text: "Báo cáo ca trực, nhận lệnh qua bộ đàm, gọi tên máy chính, máy đèn, nồi hơi, máy lọc dầu.", path: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></> },
  { title: "Giải thích bằng tiếng Việt", text: "Không hiểu chỗ nào có giải thích tiếng Việt ngay chỗ đó.", path: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  { title: "Học khi tàu mất mạng", text: "Tải bài về máy khi có Starlink, ra khơi vẫn học tiếp. Có mạng lại tự đồng bộ tiến độ.", path: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" /> },
];

const STEPS = [
  { title: "Chọn khóa, bấm Mua", text: "Đăng nhập bằng email hoặc Google." },
  { title: "Quét mã QR bằng app ngân hàng", text: "Nhập đúng số tiền và nội dung là mã đơn. Mọi ngân hàng Việt Nam đều quét được." },
  { title: "Mở app, vào học", text: "Khóa học tự mở sau khi hệ thống nhận được tiền." },
];

const FAQ = [
  { q: "Thanh toán bằng cách nào?", a: "Quét mã QR bằng app ngân hàng bất kỳ, nhập đúng số tiền và nội dung là mã đơn. Tiền chuyển thẳng vào tài khoản ngân hàng của chúng tôi." },
  { q: "Chuyển khoản xong bao lâu thì học được?", a: "Trang thanh toán tự chuyển sang “Thanh toán thành công” khi hệ thống nhận được tiền. Nếu chuyển sai số tiền hoặc sai nội dung, chúng tôi đối chiếu và xử lý tay." },
  { q: "Trên tàu không có mạng thì học thế nào?", a: "Tải bài về máy khi có mạng bờ hoặc Starlink. Khi mất mạng vẫn học được các bài đã tải." },
  { q: "Học trên mấy thiết bị?", a: "Mỗi tài khoản đăng nhập cùng lúc trên tối đa 2 thiết bị, chạy được cả Android và iPhone." },
];

async function Courses() {
  await connection();
  const courses = await listPublishedCourses();
  if (courses.length === 0) return <p className={ui.notice}>Các khóa học sắp ra mắt.</p>;
  return <div className={ui.grid}>{courses.map((c) => <CourseCard key={c.slug} course={c} />)}</div>;
}

export default function HomePage() {
  return (
    <main>
      <section className={`${styles.hero} ${ui.section}`}>
        <div className={`${ui.wrap} ${styles.heroRow}`}>
          <span className={ui.chip}>Tiếng Anh cho thuyền viên bộ phận máy</span>
          <h1 className={ui.h1}>Nói được tiếng Anh trong buồng máy, mỗi ngày chỉ 10 phút</h1>
          <p className={styles.heroText}>Bài học do máy trưởng tàu dầu soạn, đúng tình huống thật trên tàu, giải thích bằng tiếng Việt. Học trên điện thoại, học được cả khi tàu mất mạng.</p>
          <div className={ui.row}>
            <Link className={ui.action} href="/khoa-hoc">Học thử 3 bài miễn phí</Link>
            <Link className={ui.outline} href="#khoa-hoc">Xem các khóa</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-why" className={ui.section}>
        <div className={`${ui.wrap} ${styles.stack}`}>
          <div>
            <h2 id="h-why" className={ui.h2}>Học đúng thứ cần dùng trên tàu</h2>
            <p className={ui.lead}>Không học ngữ pháp dài dòng. Mỗi bài là một tình huống anh em gặp thật trong buồng máy.</p>
          </div>
          <div className={ui.grid}>
            {BENEFITS.map((b) => (
              <div key={b.title} className={styles.benefit}>
                <span className={styles.icon}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{b.path}</svg></span>
                <h3 className={ui.h3}>{b.title}</h3>
                <p className={ui.lead}>{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="khoa-hoc" aria-labelledby="h-courses" className={`${styles.alt} ${ui.section}`}>
        <div className={`${ui.wrap} ${styles.stack}`}>
          <div>
            <h2 id="h-courses" className={ui.h2}>Chọn khóa học</h2>
            <p className={ui.lead}>Học thử 3 bài đầu trước khi mua.</p>
          </div>
          <Suspense fallback={<p className={ui.muted}>Đang tải danh sách khóa…</p>}><Courses /></Suspense>
        </div>
      </section>

      <section id="cach-hoc" aria-labelledby="h-how" className={ui.section}>
        <div className={`${ui.wrap} ${styles.stack}`}>
          <h2 id="h-how" className={ui.h2}>Mua xong là học được ngay</h2>
          <ol className={`${styles.steps} ${ui.grid}`}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step}>
                <span className={styles.num}>{i + 1}</span>
                <h3 className={ui.h3}>{s.title}</h3>
                <p className={ui.lead}>{s.text}</p>
              </li>
            ))}
          </ol>
          <Link href="/gioi-thieu">Đọc thêm về người soạn bài →</Link>
        </div>
      </section>

      <section id="hoi-dap" aria-labelledby="h-faq" className={`${styles.alt} ${ui.section}`}>
        <div className={`${ui.wrap} ${styles.faq}`}>
          <h2 id="h-faq" className={ui.h2}>Hỏi đáp</h2>
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={ui.section}>
        <div className={ui.wrap}>
          <div className={styles.cta}>
            <div>
              <h2 className={ui.h2}>Bắt đầu với 3 bài miễn phí</h2>
              <p>Không cần thẻ, không cần chuyển khoản. Thấy hợp thì mua.</p>
            </div>
            <Link className={ui.action} href="/khoa-hoc">Học thử miễn phí</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
