"use client";

import { useCallback, useEffect, useState } from "react";
import { learnerCsrfHeader } from "@/lib/client/api";
import { formatVnd } from "@/lib/format";
import styles from "../hoc/learn.module.css";

type Order = { code: string; status: string; amountVnd: number; paidAt: string | null; course: string; refund: { status: string } | null };

const REFUND_STATUS: Record<string, string> = {
  requested: "Đã gửi yêu cầu hoàn tiền, đang chờ xem xét",
  approved: "Yêu cầu hoàn tiền đã được duyệt, đang chuyển tiền",
  sent: "Đã chuyển tiền hoàn, đang xác nhận",
  confirmed: "Đã hoàn tiền",
  failed: "Chuyển tiền hoàn lỗi, người hỗ trợ sẽ liên hệ",
  cancelled: "Yêu cầu hoàn tiền đã hủy",
};
const ERROR: Record<string, string> = {
  active_full_refund: "Đơn này đã có yêu cầu hoàn tiền đang xử lý.",
  not_paid: "Đơn này chưa thanh toán hoặc đã hoàn.",
  not_found: "Không tìm thấy đơn.",
};

function RefundForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const [form, setForm] = useState({ reason: "", bankName: "", accountNo: "", accountName: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (name: keyof typeof form, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={styles.field}>
      <span>{label} *</span>
      <input className={styles.input} required value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...extra} />
    </label>
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const res = await fetch("/api/me/refunds", {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerCsrfHeader() },
      body: JSON.stringify({ orderCode: order.code, reason: form.reason, payout: { bankName: form.bankName, accountNo: form.accountNo.replace(/\s/g, ""), accountName: form.accountName } }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return onDone();
    if (res?.status === 400) return setProblem("Kiểm tra lại: số tài khoản chỉ gồm chữ số, các ô đều phải điền.");
    const data = (await res?.json().catch(() => ({}))) as { error?: string };
    setProblem(ERROR[data?.error ?? ""] ?? "Không gửi được yêu cầu, thử lại sau.");
  }

  return (
    <form className={styles.refundForm} onSubmit={submit}>
      <p className={styles.muted}>Tiền hoàn chỉ chuyển về tài khoản anh/chị khai dưới đây. Xem <a href="/chinh-sach?tab=hoan-tien">chính sách hoàn tiền</a>.</p>
      <label className={styles.field}>
        <span>Lý do *</span>
        <textarea className={styles.input} required maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </label>
      {field("bankName", "Ngân hàng nhận tiền")}
      {field("accountNo", "Số tài khoản", { inputMode: "numeric" })}
      {field("accountName", "Tên chủ tài khoản")}
      {problem && <p className={styles.bannerDanger} role="alert">{problem}</p>}
      <button className={styles.primary} disabled={busy}>{busy ? "Đang gửi…" : "Gửi yêu cầu hoàn tiền"}</button>
    </form>
  );
}

export function MyOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/me/refunds", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setError(true);
    setError(false);
    setOrders(((await res.json()) as { orders: Order[] }).orders);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className={styles.card}>
      <h2 className={styles.h2}>Đơn đã mua</h2>
      {error && <p className={styles.muted}>Chưa tải được danh sách đơn.</p>}
      {!orders && !error && <p className={styles.muted}>Đang tải…</p>}
      {orders?.length === 0 && <p className={styles.muted}>Chưa có đơn nào đã thanh toán.</p>}
      {orders?.map((o) => {
        const canRequest = o.status === "paid" && (!o.refund || ["failed", "cancelled"].includes(o.refund.status));
        return (
          <div key={o.code} className={styles.item}>
            <p className={styles.en}>{o.course}</p>
            <p className={styles.vi}>{o.code} · {formatVnd(o.amountVnd)}{o.status === "refunded" ? " · đã hoàn tiền" : ""}</p>
            {o.refund && o.status !== "refunded" && <p className={styles.vi}>{REFUND_STATUS[o.refund.status] ?? o.refund.status}</p>}
            {canRequest && open !== o.code && <button className={styles.secondary} onClick={() => setOpen(o.code)}>Yêu cầu hoàn tiền</button>}
            {canRequest && open === o.code && <RefundForm order={o} onDone={() => { setOpen(null); void load(); }} />}
          </div>
        );
      })}
    </div>
  );
}
