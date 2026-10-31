"use client";

import { useState } from "react";
import { formatVnd } from "@/lib/format";
import { adminApi, Field, fmtTime, LoadState, messageFor, ORDER_STATUS, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Order = { code: string; status: string; amountVnd: number; createdAt: string; paidAt: string | null; course: string; learner: string };
type Page = { orders: Order[]; nextCursor: string | null };

export default function OrdersPage() {
  const [status, setStatus] = useState("");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [more, setMore] = useState<{ orders: Order[]; cursor: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const query = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const { data, ...state } = useLoad<Page>(`/api/quan-tri/orders?${query}`);
  const orders = [...(data?.orders ?? []), ...(more?.orders ?? [])];
  const cursor = more ? more.cursor : data?.nextCursor ?? null;

  async function loadMore() {
    const r = await adminApi<Page>(`/api/quan-tri/orders?${query}&cursor=${encodeURIComponent(cursor!)}`);
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setMore({ orders: [...(more?.orders ?? []), ...r.data.orders], cursor: r.data.nextCursor });
  }

  return (
    <>
      <h1 className={styles.h1}>Đơn hàng</h1>
      <form className={styles.card} onSubmit={(e) => { e.preventDefault(); setMore(null); setQ(input); }}>
        <Field label="Trạng thái">
          <select className={styles.input} value={status} onChange={(e) => { setMore(null); setStatus(e.target.value); }}>
            <option value="">Tất cả</option>
            {Object.entries(ORDER_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Mã đơn"><input className={styles.input} value={input} onChange={(e) => setInput(e.target.value)} /></Field>
        <div className={styles.actions}><button className={styles.btnMain}>Tìm</button></div>
      </form>
      <LoadState {...state} />
      {data && orders.length === 0 && <p className={styles.muted}>Không có đơn nào.</p>}
      {orders.length > 0 && (
        <section className={styles.card}>
          {orders.map((o) => (
            <div key={o.code} className={styles.item}>
              <div className={styles.itemText}><span className={styles.code}>{o.code}</span><span className={styles.muted}>{o.learner} · {o.course}</span><span className={styles.muted}>Tạo {fmtTime(o.createdAt)}{o.paidAt ? ` · Trả ${fmtTime(o.paidAt)}` : ""}</span></div>
              <strong>{formatVnd(o.amountVnd)}</strong>
              <span className={ORDER_STATUS[o.status]?.className}>{ORDER_STATUS[o.status]?.label ?? o.status}</span>
            </div>
          ))}
        </section>
      )}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {cursor && <div className={styles.actions}><button className={styles.btn} onClick={() => void loadMore()}>Xem thêm</button></div>}
    </>
  );
}
