"use client";

import { useState } from "react";
import { formatVnd } from "@/lib/format";
import { ActionDialog, adminApi, can, Field, fmtTime, LoadState, problemOf, useAdmin, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Refund = { id: string; kind: string; amountVnd: number; status: string; reason: string; requestedAt: string; order: { code: string } };
type Step = "approve" | "send" | "confirm" | "fail" | "cancel";
type Dialog = { refund: Refund; step: Step } | { create: true };

const STATUS: Record<string, { label: string; className: string }> = {
  requested: { label: "Đề nghị", className: styles.tagWarn! },
  approved: { label: "Đã duyệt", className: styles.tagWarn! },
  sent: { label: "Đã chuyển", className: styles.tagWarn! },
  confirmed: { label: "Đã xác nhận", className: styles.tagOk! },
  failed: { label: "Lỗi", className: styles.tagBad! },
  cancelled: { label: "Đã hủy", className: styles.tag! },
};
const STEP_LABEL: Record<Step, string> = { approve: "Duyệt", send: "Đã chuyển tiền", confirm: "Xác nhận", fail: "Báo lỗi", cancel: "Hủy yêu cầu" };
const NEXT: Record<string, Step[]> = { requested: ["approve", "cancel"], approved: ["send", "cancel"], sent: ["confirm", "fail"] };

export default function RefundsPage() {
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<{ refunds: Refund[] }>("/api/quan-tri/refunds");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [name]: e.target.value });
  const open = (next: Dialog) => { setProblem(null); setForm({}); setDialog(next); };
  const step = dialog && "step" in dialog ? dialog.step : null;
  const refund = dialog && "refund" in dialog ? dialog.refund : null;

  async function submit() {
    setBusy(true);
    const r = refund && step
      ? await adminApi(`/api/quan-tri/refunds/${refund.id}`, { method: "POST", body: { action: step, ...form } })
      : await adminApi("/api/quan-tri/refunds", { method: "POST", body: { orderCode: form.orderCode?.trim().toUpperCase(), reason: form.reason } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setDialog(null);
    await reload();
  }

  return (
    <>
      <h1 className={styles.h1}>Hoàn tiền</h1>
      {can(me, "refunds.request") && <div className={styles.actions}><button className={styles.btnMain} onClick={() => open({ create: true })}>Đề nghị hoàn tiền</button></div>}
      <LoadState {...state} reload={reload} />
      {data && (
        <section className={styles.card}>
          {data.refunds.length === 0 && <p className={styles.muted}>Chưa có yêu cầu hoàn tiền nào.</p>}
          {data.refunds.map((x) => (
            <div key={x.id} className={styles.item}>
              <div className={styles.itemText}>
                <span><span className={styles.code}>{x.order.code}</span> · {x.kind === "full" ? "Toàn phần" : "Phần thừa"} · <strong>{formatVnd(x.amountVnd)}</strong></span>
                <span className={styles.muted}>{x.reason} · {fmtTime(x.requestedAt)}</span>
              </div>
              <span className={STATUS[x.status]?.className}>{STATUS[x.status]?.label ?? x.status}</span>
              {can(me, "refunds.approve") && (NEXT[x.status]?.length ?? 0) > 0 && (
                <div className={styles.actions}>{NEXT[x.status]!.map((s) => <button key={s} className={styles.btn} onClick={() => open({ refund: x, step: s })}>{STEP_LABEL[s]}</button>)}</div>
              )}
            </div>
          ))}
        </section>
      )}
      <ActionDialog open={dialog !== null && !refund} title="Đề nghị hoàn tiền toàn phần" confirmLabel="Gửi đề nghị" busy={busy} problem={problem} onClose={() => setDialog(null)} onConfirm={() => void submit()}>
        <Field label="Mã đơn *"><input className={styles.input} required value={form.orderCode ?? ""} onChange={set("orderCode")} /></Field>
        <Field label="Lý do *"><textarea className={styles.input} required value={form.reason ?? ""} onChange={set("reason")} /></Field>
      </ActionDialog>
      <ActionDialog open={refund !== null} title={`${step ? STEP_LABEL[step] : ""}: ${refund ? formatVnd(refund.amountVnd) : ""} · đơn ${refund?.order.code ?? ""}`} confirmLabel={step ? STEP_LABEL[step] : ""} danger={step === "confirm" || step === "fail" || step === "cancel"} busy={busy} problem={problem} onClose={() => setDialog(null)} onConfirm={() => void submit()}>
        {step === "confirm" && refund?.kind === "full" && <p className={styles.notice}>Xác nhận sẽ chuyển đơn sang đã hoàn tiền và thu hồi quyền học; tiến độ học được giữ.</p>}
        {step === "send" && (
          <>
            <Field label="Mã giao dịch chuyển trả *"><input className={styles.input} required value={form.outBankRef ?? ""} onChange={set("outBankRef")} /></Field>
            <Field label="Bằng chứng *"><textarea className={styles.input} required value={form.evidence ?? ""} onChange={set("evidence")} /></Field>
          </>
        )}
        {(step === "fail" || step === "cancel") && <Field label="Lý do *"><textarea className={styles.input} required value={form.reason ?? ""} onChange={set("reason")} /></Field>}
      </ActionDialog>
    </>
  );
}
