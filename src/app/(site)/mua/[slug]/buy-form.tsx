"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { learnerCsrfHeader } from "@/lib/client/api";
import { formatVnd } from "@/lib/format";
import ui from "@/components/ui.module.css";
import styles from "./buy.module.css";
import { GuestForm } from "./guest-form";

type Problem = "terms" | "enrolled" | "not_for_sale" | "unavailable" | "failed" | null;

const MESSAGE: Record<Exclude<Problem, null>, string> = {
  terms: "Cần đồng ý điều khoản để mua.",
  enrolled: "Bạn đã có khóa này.",
  not_for_sale: "Khóa này hiện chưa mở bán.",
  unavailable: "Chưa mở thanh toán. Vui lòng quay lại sau.",
  failed: "Không tạo được đơn, thử lại sau.",
};

/** refundPolicy: công tắc hoàn tiền đọc ở máy chủ (biến môi trường không có trong mã trình duyệt). */
/** autoConfirm: SePay đang bật (tiền về tự mở khóa); tắt thì khách bấm "Tôi đã chuyển khoản" là học ngay. */
export function BuyForm({ slug, titleVi, priceVnd, lessonCount, refundPolicy, autoConfirm }: {
  slug: string; titleVi: string; priceVnd: number; lessonCount: number; refundPolicy: boolean; autoConfirm: boolean;
}) {
  const [name, setName] = useState<string | null>(null);
  // Chưa biết / khách chưa đăng nhập (mua ngay, tài khoản tạo trên trang này) / đã đăng nhập.
  const [who, setWho] = useState<"unknown" | "guest" | "signed">("unknown");
  const [recent, setRecent] = useState<{ enrolled: boolean; unresolved: { code: string }[] } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  /** Tên lấy từ phiên đăng nhập, không lấy tên khách gõ (số đã có tài khoản thì tên là của tài khoản đó). */
  const loadSession = () => fetch("/api/me/session").then(async (res) => {
    if (res.status === 401) return setWho("guest");
    if (res.ok) {
      setName(((await res.json()) as { displayName: string }).displayName);
      setWho("signed");
    }
  });

  useEffect(() => {
    void loadSession();
    void fetch(`/api/me/orders?course=${encodeURIComponent(slug)}`, { cache: "no-store" }).then(async (res) => {
      if (res.ok) setRecent((await res.json()) as { enrolled: boolean; unresolved: { code: string }[] });
    });
  }, [slug]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accepted) return setProblem("terms");
    await createOrder();
  }

  /** Tạo đơn (máy chủ trả lại đơn đang chờ nếu đã có) rồi sang thanh toán. */
  async function createOrder() {
    setBusy(true);
    const res = await fetch("/api/me/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerCsrfHeader() },
      body: JSON.stringify({ courseSlug: slug, acceptTerms: true }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 401) return setWho("guest");
    if (res?.ok) return router.push(`/thanh-toan/${((await res.json()) as { code: string }).code}`);
    if (res?.status === 503) return setProblem("unavailable");
    if (res?.status === 409) {
      const { error } = (await res.json()) as { error: string };
      return setProblem(error === "already_enrolled" ? "enrolled" : "not_for_sale");
    }
    setProblem("failed");
  }

  if (recent?.enrolled) {
    return (
      <div className={ui.card}>
        <h1 className={ui.h2}>Thông tin người mua</h1>
        <p className={ui.lead}>Bạn đã có khóa {titleVi}.</p>
        <Link className={ui.primary} href={`/hoc?khoa=${slug}`}>Vào học</Link>
      </div>
    );
  }

  const terms = (
    <label className={styles.terms}>
      <input type="checkbox" checked={accepted} aria-invalid={problem === "terms"}
        onChange={(e) => { setAccepted(e.target.checked); setProblem(null); }} />
      <span>Tôi đồng ý <Link href="/chinh-sach?tab=dieu-khoan">điều khoản sử dụng</Link>{refundPolicy && <> và <Link href="/chinh-sach?tab=hoan-tien">chính sách hoàn tiền</Link></>}.</span>
    </label>
  );

  const summary = (
    <aside className={`${ui.card} ${styles.summary}`} aria-label="Đơn hàng">
      <h2 className={ui.h3}>Đơn hàng</h2>
      <p className={ui.lead} style={{ margin: 0 }}><strong>{titleVi}</strong></p>
      <p className={ui.muted} style={{ margin: 0 }}>{lessonCount} bài</p>
      <div className={styles.total}>
        <span>Tổng thanh toán</span>
        <span className={ui.price}>{formatVnd(priceVnd)}</span>
      </div>
      <ul className={styles.points}>
        <li>Thanh toán bằng VietQR, mọi ngân hàng Việt Nam.</li>
        <li>{autoConfirm ? "Khóa học mở ngay khi hệ thống nhận được tiền." : "Chuyển khoản xong, bấm \"Tôi đã chuyển khoản\" là học được ngay."}</li>
        <li>Mã QR giữ trong 15 phút.</li>
      </ul>
    </aside>
  );

  if (who === "guest") {
    return (
      <div className={styles.layout}>
        <div className={ui.card}>
          <h1 className={ui.h2}>Thông tin người mua</h1>
          <p className={ui.lead}>Chưa có tài khoản? Điền họ tên và số điện thoại, hệ thống tạo tài khoản cho bạn ngay.</p>
          <GuestForm slug={slug} terms={terms} termsAccepted={accepted} onBlocked={() => setProblem("terms")}
            onSignedIn={() => { setName(null); setWho("signed"); void loadSession(); void createOrder(); }} />
          {problem && <p className={ui.error} role="alert">{MESSAGE[problem]}</p>}
          {busy && <p className={ui.muted} role="status">Đang tạo đơn…</p>}
        </div>
        {summary}
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <form onSubmit={submit} className={ui.card}>
        <h1 className={ui.h2}>Thông tin người mua</h1>
        <p className={ui.lead}>Đơn được gắn với tài khoản đang đăng nhập, nên khóa học mở đúng cho bạn.</p>
        {recent && recent.unresolved.length > 0 && (
          <div className={ui.notice} role="status">
            <p>Đã chuyển tiền cho đơn trước rồi? Đừng chuyển lại. Xem trạng thái đơn:</p>
            {recent.unresolved.map((o) => <p key={o.code}><Link href={`/thanh-toan/${o.code}`}>{o.code}</Link></p>)}
          </div>
        )}
        <div className={styles.account}>
          <span>Tài khoản mua</span>
          <strong>{name ?? "…"}</strong>
        </div>
        {terms}
        {problem && <p className={ui.error} role="alert">{MESSAGE[problem]}</p>}
        {problem === "enrolled"
          ? <Link className={ui.primary} href={`/hoc?khoa=${slug}`}>Vào học</Link>
          : <button className={ui.action} disabled={busy}>{busy ? "Đang tạo đơn…" : "Tiếp tục thanh toán"}</button>}
      </form>
      {summary}
    </div>
  );
}
