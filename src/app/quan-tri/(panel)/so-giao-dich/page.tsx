"use client";

import { useState } from "react";
import { formatVnd } from "@/lib/format";
import { ActionDialog, adminApi, can, Field, fmtTime, LoadState, messageFor, problemOf, QUEUE_REASON, useAdmin, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Row = { bankTransactionId: string; bankTime: string; amountVnd: number; content: string | null; source: string; reason: string; candidateCodes: string[]; candidateOrderCode: string | null };
type Unresolved = { observationId: string; source: string; reason: string; receivedAt: string };
type Action = { kind: "match" | "verify" | "dispose"; rows: Row[] } | { kind: "enter" } | { kind: "reopen" };

const MATCH_RESULT: Record<string, string> = {
  paid: "Đã ghép: đơn chuyển sang đã thanh toán.",
  paid_with_excess_refund: "Đã ghép: đơn đã thanh toán, phần thừa đã tạo yêu cầu hoàn.",
  short: "Đã ghi nhận nhưng chưa đủ tiền: đơn vẫn chờ.",
};

export default function LedgerPage() {
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<{ queue: Row[]; unresolved: Unresolved[] }>("/api/quan-tri/ledger");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = me?.role === "owner";
  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [name]: e.target.value });
  const open = (next: Action, initial: Record<string, string> = {}) => { setProblem(null); setDone(null); setForm(initial); setAction(next); };
  const picked = data?.queue.filter((r) => selected.has(r.bankTransactionId)) ?? [];
  const total = (rows: Row[]) => rows.reduce((sum, r) => sum + r.amountVnd, 0);

  async function submit() {
    if (!action) return;
    setBusy(true);
    let r;
    let success = "Đã lưu.";
    if (action.kind === "match") {
      r = await adminApi<{ result: string }>("/api/quan-tri/ledger/match", { method: "POST", body: { orderCode: form.orderCode?.trim().toUpperCase(), bankTransactionIds: action.rows.map((x) => x.bankTransactionId), note: form.note, evidence: form.evidence } });
      success = MATCH_RESULT[r.data.result ?? ""] ?? success;
    } else if (action.kind === "verify") {
      r = await adminApi(`/api/quan-tri/ledger/${action.rows[0]!.bankTransactionId}/verify`, { method: "POST", body: { evidence: form.evidence } });
    } else if (action.kind === "dispose") {
      r = await adminApi(`/api/quan-tri/ledger/${action.rows[0]!.bankTransactionId}/disposition`, { method: "POST", body: { kind: form.kind ?? "ignored", reason: form.reason } });
    } else if (action.kind === "reopen") {
      r = await adminApi(`/api/quan-tri/ledger/${encodeURIComponent(form.id?.trim() ?? "")}/reopen`, { method: "POST", body: { reason: form.reason } });
    } else {
      // Giờ nhập theo giờ Việt Nam; gửi kèm múi giờ để máy chủ không hiểu nhầm.
      r = await adminApi<{ outcome: string }>("/api/quan-tri/ledger", { method: "POST", body: {
        bankCode: form.bankCode?.trim().toUpperCase(), accountNo: form.accountNo?.trim(), bankRef: form.bankRef?.trim(), amountVnd: Number(form.amountVnd),
        bankTime: `${(form.bankTime ?? "").slice(0, 16)}:00+07:00`, content: form.content ?? "", evidence: form.evidence,
      } });
    }
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(r.status === 400 ? `${messageFor(r.data.error)}` : issue);
    setAction(null);
    setSelected(new Set());
    setDone(success);
    await reload();
  }

  const rows = action && "rows" in action ? action.rows : [];
  return (
    <>
      <h1 className={styles.h1}>Sổ giao dịch</h1>
      <div className={styles.actions}>
        {can(me, "ledger.enter") && <button className={styles.btn} onClick={() => open({ kind: "enter" })}>Nhập dòng sao kê</button>}
        {isOwner && <button className={styles.btn} onClick={() => open({ kind: "reopen" })}>Mở lại giao dịch</button>}
      </div>
      {done && <p className={styles.ok} role="status">{done}</p>}
      <LoadState {...state} reload={reload} />
      {data && (
        <section className={styles.card}>
          <h2 className={styles.h2}>Cần xử lý tay ({data.queue.length})</h2>
          {data.queue.length === 0 && <p className={styles.muted}>Không có khoản nào cần xử lý.</p>}
          {data.queue.map((r) => (
            <div key={r.bankTransactionId} className={styles.item}>
              <label style={{ display: "flex", minHeight: 44, alignItems: "center" }}>
                <input type="checkbox" aria-label={`Chọn khoản ${formatVnd(r.amountVnd)}`} style={{ width: 22, height: 22 }} checked={selected.has(r.bankTransactionId)}
                  onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(r.bankTransactionId); else next.delete(r.bankTransactionId); setSelected(next); }} />
              </label>
              <div className={styles.itemText}>
                <strong>{formatVnd(r.amountVnd)}</strong>
                <span className={styles.muted}>{fmtTime(r.bankTime)} · {r.source}{r.candidateOrderCode ? ` · đơn ${r.candidateOrderCode}` : ""}</span>
                {r.content !== null && <span className={styles.muted}>{r.content}</span>}
              </div>
              <span className={styles.tagWarn}>{QUEUE_REASON[r.reason] ?? r.reason}</span>
              <div className={styles.actions}>
                {r.reason === "unverified"
                  ? isOwner && <button className={styles.btn} onClick={() => open({ kind: "verify", rows: [r] })}>Xác minh</button>
                  : <button className={styles.btn} onClick={() => open({ kind: "match", rows: [r] }, { orderCode: r.candidateOrderCode ?? "" })}>Ghép với đơn</button>}
                {isOwner && <button className={styles.btn} onClick={() => open({ kind: "dispose", rows: [r] }, { kind: "ignored" })}>Bỏ qua / trùng</button>}
              </div>
            </div>
          ))}
          {picked.length > 1 && (
            <div className={styles.actions}><button className={styles.btnMain} onClick={() => open({ kind: "match", rows: picked })}>Ghép {picked.length} khoản ({formatVnd(total(picked))}) với một đơn</button></div>
          )}
        </section>
      )}
      {data && data.unresolved.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.h2}>Thiếu dữ kiện ({data.unresolved.length})</h2>
          <p className={styles.muted}>Báo cáo thiếu mã tham chiếu hoặc thời điểm, chưa vào sổ. Nhập dòng sao kê để bổ sung.</p>
          {data.unresolved.map((u) => <div key={u.observationId} className={styles.item}><span>{u.reason === "missing_ref" ? "Thiếu mã tham chiếu" : "Thiếu thời điểm"}</span><span className={styles.muted}>{fmtTime(u.receivedAt)}</span></div>)}
        </section>
      )}

      <ActionDialog open={action?.kind === "match"} title={`Ghép ${formatVnd(total(rows))} với đơn`} confirmLabel="Ghép với đơn" busy={busy} problem={problem} onClose={() => setAction(null)} onConfirm={() => void submit()}>
        <p className={styles.muted}>Đơn sẽ chuyển sang đã thanh toán nếu đủ tiền, và mở khóa học cho học viên.</p>
        <Field label="Mã đơn *"><input className={styles.input} required value={form.orderCode ?? ""} onChange={set("orderCode")} /></Field>
        <Field label="Ghi chú *"><textarea className={styles.input} required value={form.note ?? ""} onChange={set("note")} /></Field>
        <Field label="Bằng chứng *"><textarea className={styles.input} required value={form.evidence ?? ""} onChange={set("evidence")} /></Field>
      </ActionDialog>
      <ActionDialog open={action?.kind === "verify"} title={`Xác minh khoản ${formatVnd(total(rows))}`} confirmLabel="Xác minh" busy={busy} problem={problem} onClose={() => setAction(null)} onConfirm={() => void submit()}>
        <p className={styles.muted}>Người nhập dòng sao kê không được tự xác minh.</p>
        <Field label="Bằng chứng đã đối chiếu *"><textarea className={styles.input} required value={form.evidence ?? ""} onChange={set("evidence")} /></Field>
      </ActionDialog>
      <ActionDialog open={action?.kind === "dispose"} title={`Kết luận khoản ${formatVnd(total(rows))}`} confirmLabel="Lưu kết luận" danger busy={busy} problem={problem} onClose={() => setAction(null)} onConfirm={() => void submit()}>
        <Field label="Kết luận"><select className={styles.input} value={form.kind ?? "ignored"} onChange={set("kind")}><option value="ignored">Bỏ qua</option><option value="duplicate">Trùng</option></select></Field>
        <Field label="Lý do *"><textarea className={styles.input} required value={form.reason ?? ""} onChange={set("reason")} /></Field>
      </ActionDialog>
      <ActionDialog open={action?.kind === "reopen"} title="Mở lại giao dịch đã kết luận" confirmLabel="Mở lại" busy={busy} problem={problem} onClose={() => setAction(null)} onConfirm={() => void submit()}>
        <Field label="Mã giao dịch *"><input className={styles.input} required value={form.id ?? ""} onChange={set("id")} /></Field>
        <Field label="Lý do *"><textarea className={styles.input} required value={form.reason ?? ""} onChange={set("reason")} /></Field>
      </ActionDialog>
      <ActionDialog open={action?.kind === "enter"} title="Nhập dòng sao kê" confirmLabel="Lưu dòng sao kê" busy={busy} problem={problem} onClose={() => setAction(null)} onConfirm={() => void submit()}>
        <p className={styles.muted}>Dòng nhập tay cần chủ xác minh trước khi ghép.</p>
        <Field label="Mã ngân hàng *"><input className={styles.input} required value={form.bankCode ?? ""} onChange={set("bankCode")} /></Field>
        <Field label="Số tài khoản nhận *"><input className={styles.input} required inputMode="numeric" value={form.accountNo ?? ""} onChange={set("accountNo")} /></Field>
        <Field label="Mã giao dịch ngân hàng *"><input className={styles.input} required value={form.bankRef ?? ""} onChange={set("bankRef")} /></Field>
        <Field label="Số tiền (đồng) *"><input className={styles.input} required type="number" min={1} value={form.amountVnd ?? ""} onChange={set("amountVnd")} /></Field>
        <Field label="Thời điểm ngân hàng (giờ Việt Nam) *"><input className={styles.input} required type="datetime-local" value={form.bankTime ?? ""} onChange={set("bankTime")} /></Field>
        <Field label="Nội dung chuyển khoản"><textarea className={styles.input} value={form.content ?? ""} onChange={set("content")} /></Field>
        <Field label="Bằng chứng *"><textarea className={styles.input} required value={form.evidence ?? ""} onChange={set("evidence")} /></Field>
      </ActionDialog>
    </>
  );
}
