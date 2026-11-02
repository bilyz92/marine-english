"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { learnerCsrfHeader } from "@/lib/client/api";
import { formatVnd } from "@/lib/format";
import ui from "@/components/ui.module.css";

type Problem = "terms" | "enrolled" | "not_for_sale" | "unavailable" | "failed" | null;

const MESSAGE: Record<Exclude<Problem, null>, string> = {
  terms: "Cần đồng ý điều khoản để mua.",
  enrolled: "Bạn đã có khóa này.",
  not_for_sale: "Khóa này hiện chưa mở bán.",
  unavailable: "Chưa mở thanh toán. Vui lòng quay lại sau.",
  failed: "Không tạo được đơn, thử lại sau.",
};

/** refundPolicy: công tắc hoàn tiền đọc ở máy chủ (biến môi trường không có trong mã trình duyệt). */
export function BuyForm({ slug, titleVi, priceVnd, refundPolicy }: { slug: string; titleVi: string; priceVnd: number; refundPolicy: boolean }) {
  const [name, setName] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ enrolled: boolean; unresolved: { code: string }[] } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toLogin = `/dang-nhap?next=${encodeURIComponent(`/mua/${slug}`)}`;

  useEffect(() => {
    void fetch("/api/me/session").then(async (res) => {
      if (res.status === 401) return router.replace(toLogin);
      if (res.ok) setName(((await res.json()) as { displayName: string }).displayName);
    });
    void fetch(`/api/me/orders?course=${encodeURIComponent(slug)}`, { cache: "no-store" }).then(async (res) => {
      if (res.ok) setRecent((await res.json()) as { enrolled: boolean; unresolved: { code: string }[] });
    });
  }, [router, toLogin, slug]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accepted) return setProblem("terms");
    setBusy(true);
    const res = await fetch("/api/me/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerCsrfHeader() },
      body: JSON.stringify({ courseSlug: slug, acceptTerms: true }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 401) return router.replace(toLogin);
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
        <p className={ui.lead}>Bạn đã có khóa {titleVi}.</p>
        <Link className={ui.primary} href={`/hoc?khoa=${slug}`}>Vào học</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={ui.card}>
      {recent && recent.unresolved.length > 0 && (
        <div className={ui.notice} role="status">
          <p>Đã chuyển tiền cho đơn trước rồi? Đừng chuyển lại. Xem trạng thái đơn:</p>
          {recent.unresolved.map((o) => <p key={o.code}><Link href={`/thanh-toan/${o.code}`}>{o.code}</Link></p>)}
        </div>
      )}
      {name && <p className={ui.lead}>Tài khoản: <strong>{name}</strong></p>}
      <h2 className={ui.h3}>{titleVi}</h2>
      <span className={ui.price}>{formatVnd(priceVnd)}</span>
      <p className={ui.muted}>Giá do hệ thống tính. Đơn giữ trong 15 phút.</p>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44 }}>
        <input type="checkbox" checked={accepted} aria-invalid={problem === "terms"} style={{ width: 22, height: 22, flex: "none" }}
          onChange={(e) => { setAccepted(e.target.checked); setProblem(null); }} />
        <span>Tôi đồng ý <Link href="/chinh-sach?tab=dieu-khoan">điều khoản</Link>{refundPolicy && <> và <Link href="/chinh-sach?tab=hoan-tien">chính sách hoàn tiền</Link></>}.</span>
      </label>
      {problem && <p className={ui.error} role="alert">{MESSAGE[problem]}</p>}
      {problem === "enrolled"
        ? <Link className={ui.primary} href={`/hoc?khoa=${slug}`}>Vào học</Link>
        : <button className={ui.action} disabled={busy}>{busy ? "Đang tạo đơn…" : "Sang thanh toán"}</button>}
    </form>
  );
}
