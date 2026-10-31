"use client";

import { useState } from "react";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { fmtTime, LoadState, ORDER_STATUS, QUEUE_REASON, useLoad } from "./admin-lib";
import styles from "./admin.module.css";

type Overview = {
  receivedVnd: number; refundedVnd: number; paidOrders: { auto: number; manual: number }; newLearners: number; refundsOpen: number; queueOpen: number;
  oldestQueue: { bankTransactionId: string; bankTime: string; amountVnd: number; reason: string; candidateOrderCode: string | null }[];
  recentOrders: { code: string; status: string; amountVnd: number; createdAt: string; course: string; learner: string }[];
  jobs: { name: string; status: string; startedAt: string; error: string | null }[];
};
const RANGES = [{ days: 1, label: "Hôm nay" }, { days: 7, label: "7 ngày" }, { days: 30, label: "30 ngày" }];

export default function OverviewPage() {
  const [days, setDays] = useState(1);
  const { data, ...state } = useLoad<Overview>(`/api/quan-tri/overview?days=${days}`);
  const paid = data ? data.paidOrders.auto + data.paidOrders.manual : 0;
  return (
    <>
      <h1 className={styles.h1}>Tổng quan</h1>
      <div className={styles.actions}>
        {RANGES.map((r) => <button key={r.days} className={r.days === days ? styles.btnMain : styles.btn} aria-pressed={r.days === days} onClick={() => setDays(r.days)}>{r.label}</button>)}
      </div>
      <LoadState {...state} />
      {data && (
        <>
          {(data.queueOpen > 0 || data.refundsOpen > 0) && (
            <p className={styles.notice}>
              <Link href="/quan-tri/so-giao-dich">{data.queueOpen} khoản cần xử lý tay</Link> · <Link href="/quan-tri/hoan-tien">{data.refundsOpen} yêu cầu hoàn tiền</Link>
            </p>
          )}
          <div className={styles.stats}>
            <div className={styles.card}><span className={styles.label}>Tiền đã nhận</span><span className={styles.stat}>{formatVnd(data.receivedVnd)}</span></div>
            <div className={styles.card}><span className={styles.label}>Đã hoàn</span><span className={styles.stat}>{formatVnd(data.refundedVnd)}</span></div>
            <div className={styles.card}><span className={styles.label}>Đơn đã thanh toán (tự động / tay)</span><span className={styles.stat}>{data.paidOrders.auto} / {data.paidOrders.manual}</span></div>
            <div className={styles.card}><span className={styles.label}>Tỷ lệ tự động</span><span className={styles.stat}>{paid ? `${Math.round((data.paidOrders.auto / paid) * 100)}%` : "—"}</span></div>
            <div className={styles.card}><span className={styles.label}>Học viên mới</span><span className={styles.stat}>{data.newLearners}</span></div>
          </div>
          <section className={styles.card}>
            <h2 className={styles.h2}>Khoản chờ lâu nhất</h2>
            {data.oldestQueue.length === 0 && <p className={styles.muted}>Không có khoản nào cần xử lý.</p>}
            {data.oldestQueue.map((q) => (
              <div key={q.bankTransactionId} className={styles.item}>
                <div className={styles.itemText}><strong>{formatVnd(q.amountVnd)}</strong><span className={styles.muted}>{fmtTime(q.bankTime)}{q.candidateOrderCode ? ` · ${q.candidateOrderCode}` : ""}</span></div>
                <span className={styles.tagWarn}>{QUEUE_REASON[q.reason] ?? q.reason}</span>
              </div>
            ))}
          </section>
          <section className={styles.card}>
            <h2 className={styles.h2}>Đơn gần đây</h2>
            {data.recentOrders.length === 0 && <p className={styles.muted}>Chưa có đơn nào.</p>}
            {data.recentOrders.map((o) => (
              <div key={o.code} className={styles.item}>
                <div className={styles.itemText}><span className={styles.code}>{o.code}</span><span className={styles.muted}>{o.learner} · {o.course} · {fmtTime(o.createdAt)}</span></div>
                <strong>{formatVnd(o.amountVnd)}</strong>
                <span className={ORDER_STATUS[o.status]?.className}>{ORDER_STATUS[o.status]?.label ?? o.status}</span>
              </div>
            ))}
          </section>
          <section className={styles.card}>
            <h2 className={styles.h2}>Lịch chạy nền</h2>
            {data.jobs.length === 0 && <p className={styles.notice}>Worker chưa ghi lần chạy nào trong 3 ngày qua.</p>}
            {data.jobs.map((j) => (
              <div key={j.name} className={styles.item}>
                <div className={styles.itemText}><span>{j.name}</span><span className={styles.muted}>{fmtTime(j.startedAt)}{j.error ? ` · ${j.error}` : ""}</span></div>
                <span className={j.status === "success" ? styles.tagOk : j.status === "failed" || j.status === "timeout" ? styles.tagBad : styles.tag}>{j.status}</span>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
