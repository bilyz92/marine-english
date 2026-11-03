"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { formatVnd } from "@/lib/format";
import { ActionDialog, adminApi, Field, fmtTime, LoadState, messageFor, ORDER_STATUS, useAdmin, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

// Chủ quyết định 03/11/2026 (chưa có SePay): khách báo đã chuyển là học ngay; chủ đối soát ở đây: Đã nhận hoặc Chưa nhận.

type Order = {
  code: string; status: string; amountVnd: number; createdAt: string; paidAt: string | null; course: string; learner: string;
  claim: "open" | "rejected" | null; proofs: number; needsReview: boolean;
};
type Page = { orders: Order[]; nextCursor: string | null };
type Proofs = { proofs: { id: string; message: string; createdAt: string }[]; claim: { rejectionReason: string | null } };
type Action = { kind: "approve" | "reject"; order: Order };

const CLAIMED = "claimed";
const CLAIM_TAG: Record<string, { label: string; className: string }> = {
  open: { label: "Mở tạm · chờ đối soát", className: styles.tagWarn },
  rejected: { label: "Đã khóa lại", className: styles.tagBad },
};
const REASONS: Record<string, string> = {
  ref_used: "Mã giao dịch này đã dùng cho một đơn khác.",
  bank_time: "Giờ chuyển phải sau lúc tạo đơn và không ở tương lai.",
};

/** Giờ Việt Nam dạng ô datetime-local (YYYY-MM-DDTHH:mm). */
function vnLocal(value: string | Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function ProofList({ code }: { code: string }) {
  const { data, ...state } = useLoad<Proofs>(`/api/quan-tri/orders/${code}/proofs`);
  if (!data) return <LoadState {...state} />;
  return (
    <div className={styles.form}>
      {data.claim.rejectionReason && <p className={styles.muted}>Lý do đã khóa: {data.claim.rejectionReason}</p>}
      {data.proofs.length === 0 && <p className={styles.muted}>Khách chưa gửi ảnh.</p>}
      {data.proofs.map((p) => (
        <figure key={p.id} style={{ margin: 0 }}>
          <a href={`/api/quan-tri/proofs/${p.id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/quan-tri/proofs/${p.id}`} alt={`Ảnh chuyển khoản khách gửi lúc ${fmtTime(p.createdAt)}`} style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8 }} />
          </a>
          <figcaption className={styles.muted}>{fmtTime(p.createdAt)}{p.message ? ` · ${p.message}` : ""}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function OrdersPage() {
  return <Suspense><Orders /></Suspense>;
}

function Orders() {
  // Link trong tin Telegram mở thẳng đơn: /admin/don-hang?q=<mã>.
  const initialQ = useSearchParams().get("q")?.trim() ?? "";
  const me = useAdmin();
  const owner = me?.role === "owner";
  const [status, setStatus] = useState("");
  const [input, setInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [more, setMore] = useState<{ orders: Order[]; cursor: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [bankTime, setBankTime] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const query = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const { data, reload, ...state } = useLoad<Page>(`/api/quan-tri/orders?${query}`);
  const orders = [...(data?.orders ?? []), ...(more?.orders ?? [])];
  const cursor = more ? more.cursor : data?.nextCursor ?? null;

  async function loadMore() {
    const r = await adminApi<Page>(`/api/quan-tri/orders?${query}&cursor=${encodeURIComponent(cursor!)}`);
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setMore({ orders: [...(more?.orders ?? []), ...r.data.orders], cursor: r.data.nextCursor });
  }

  function start(kind: Action["kind"], order: Order) {
    setAction({ kind, order });
    setBankRef("");
    setBankTime("");
    setText(kind === "reject" ? "Sao kê chưa thấy khoản chuyển cho đơn này." : "");
    setActionProblem(null);
  }

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setActionProblem(null);
    const { code } = action.order;
    const r = action.kind === "approve"
      ? await adminApi(`/api/quan-tri/orders/${code}/approve`, { method: "POST", body: { bankRef, note: text, bankTime: `${bankTime}:00+07:00` } })
      : await adminApi(`/api/quan-tri/orders/${code}/reject`, { method: "POST", body: { reason: text } });
    setBusy(false);
    if (!r.ok) {
      const reason = r.data.reason ?? r.data.result ?? r.data.error;
      return setActionProblem(REASONS[String(reason)] ?? messageFor(reason));
    }
    setDone(action.kind === "approve" ? `Đã duyệt đơn ${code}: đơn đã thanh toán, khóa học mở hẳn.` : `Đã khóa lại đơn ${code}. Khách thấy lý do và gửi được ảnh chứng minh.`);
    setAction(null);
    setMore(null);
    reload();
  }

  return (
    <>
      <h1 className={styles.h1}>Đơn hàng</h1>
      <form className={styles.card} onSubmit={(e) => { e.preventDefault(); setMore(null); setQ(input); }}>
        <Field label="Trạng thái">
          <select className={styles.input} value={status} onChange={(e) => { setMore(null); setStatus(e.target.value); }}>
            <option value="">Tất cả</option>
            <option value={CLAIMED}>Chờ đối soát (khách báo đã chuyển)</option>
            {Object.entries(ORDER_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Mã đơn"><input className={styles.input} value={input} onChange={(e) => setInput(e.target.value)} /></Field>
        <div className={styles.actions}><button className={styles.btnMain}>Tìm</button></div>
      </form>
      {done && <p className={styles.ok} role="status">{done}</p>}
      <LoadState {...state} reload={reload} />
      {data && orders.length === 0 && <p className={styles.muted}>Không có đơn nào.</p>}
      {orders.length > 0 && (
        <section className={styles.card}>
          {orders.map((o) => {
            const unpaid = o.status === "pending" || o.status === "expired";
            return (
              <div key={o.code}>
                <div className={styles.item}>
                  <div className={styles.itemText}>
                    <span className={styles.code}>{o.code}</span>
                    <span className={styles.muted}>{o.learner} · {o.course}</span>
                    <span className={styles.muted}>Tạo {fmtTime(o.createdAt)}{o.paidAt ? ` · Trả ${fmtTime(o.paidAt)}` : ""}</span>
                  </div>
                  <strong>{formatVnd(o.amountVnd)}</strong>
                  <span className={ORDER_STATUS[o.status]?.className}>{ORDER_STATUS[o.status]?.label ?? o.status}</span>
                  {o.claim && <span className={CLAIM_TAG[o.claim]!.className}>{CLAIM_TAG[o.claim]!.label}</span>}
                  {o.needsReview && o.claim === "rejected" && <span className={styles.tagWarn}>Có ảnh mới</span>}
                </div>
                {(o.claim || o.proofs > 0 || (owner && unpaid)) && (
                  <div className={styles.actions}>
                    {owner && unpaid && <button type="button" className={styles.btnMain} onClick={() => start("approve", o)}>Đã nhận</button>}
                    {owner && (o.claim === "open" || (o.claim === "rejected" && o.needsReview)) && <button type="button" className={styles.btnDanger} onClick={() => start("reject", o)}>Chưa nhận</button>}
                    {(o.claim === "rejected" || o.proofs > 0) && (
                      <button type="button" className={styles.btn} aria-expanded={open === o.code} onClick={() => setOpen(open === o.code ? null : o.code)}>
                        {open === o.code ? "Ẩn ảnh" : `Ảnh khách gửi (${o.proofs})`}
                      </button>
                    )}
                  </div>
                )}
                {open === o.code && <ProofList code={o.code} />}
              </div>
            );
          })}
        </section>
      )}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {cursor && <div className={styles.actions}><button className={styles.btn} onClick={() => void loadMore()}>Xem thêm</button></div>}

      <ActionDialog
        open={action !== null}
        title={action?.kind === "approve" ? `Đã nhận tiền đơn ${action.order.code}` : `Chưa nhận tiền đơn ${action?.order.code ?? ""}`}
        confirmLabel={action?.kind === "approve" ? "Đã nhận: mở hẳn khóa học" : "Chưa nhận: khóa lại khóa học"}
        danger={action?.kind === "reject"}
        busy={busy}
        problem={actionProblem}
        onClose={() => setAction(null)}
        onConfirm={() => void confirm()}
      >
        {action?.kind === "approve" ? (
          <>
            <p className={styles.muted}>Chỉ bấm khi đã thấy {formatVnd(action.order.amountVnd)} với nội dung {action.order.code} trong app ngân hàng. Đơn thành đã thanh toán, khóa học mở hẳn.</p>
            <Field label="Giờ chuyển trên sao kê (giờ Việt Nam)">
              <input className={styles.input} type="datetime-local" required value={bankTime} min={vnLocal(action.order.createdAt)} max={vnLocal(new Date())} onChange={(e) => setBankTime(e.target.value)} />
            </Field>
            <Field label="Mã giao dịch trên sao kê (nên nhập, để một khoản tiền không duyệt hai đơn)">
              <input className={styles.input} value={bankRef} maxLength={100} onChange={(e) => setBankRef(e.target.value)} />
            </Field>
            <Field label="Ghi chú (không bắt buộc)"><input className={styles.input} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <p className={styles.muted}>Khóa học của khách bị khóa ngay. Khách thấy lý do dưới đây kèm dòng &quot;Tiền chưa được xác nhận&quot; và gửi được ảnh chứng minh.</p>
            <Field label="Lý do (khách sẽ thấy)">
              <textarea className={styles.input} rows={3} required maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        )}
      </ActionDialog>
    </>
  );
}
