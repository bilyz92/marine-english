"use client";

import { useState } from "react";
import { formatVnd } from "@/lib/format";
import { ActionDialog, adminApi, can, Field, LoadState, problemOf, useAdmin, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Course = { id: string; slug: string; titleVi: string; status: string; priceVnd: number | null };
const STATUS: Record<string, string> = { draft: "Nháp", published: "Đang mở bán", archived: "Đã ngừng bán" };

export default function CoursesPage() {
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<{ courses: Course[] }>("/api/quan-tri/courses");
  const [edit, setEdit] = useState<{ course: Course; kind: "price" | "published" | "archived" } | null>(null);
  const [price, setPrice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can(me, "prices.edit");
  const newPrice = Number(price);

  async function save() {
    setBusy(true);
    const body = edit!.kind === "price" ? { priceVnd: newPrice } : { status: edit!.kind };
    const r = await adminApi(`/api/quan-tri/courses/${edit!.course.id}`, { method: "PATCH", body });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setEdit(null);
    await reload();
  }

  return (
    <>
      <h1 className={styles.h1}>Khóa học</h1>
      <LoadState {...state} reload={reload} />
      {data && (
        <section className={styles.card}>
          {data.courses.length === 0 && <p className={styles.muted}>Chưa có khóa nào. Nhập nội dung bằng lệnh content:import.</p>}
          {data.courses.map((c) => (
            <div key={c.id} className={styles.item}>
              <div className={styles.itemText}><span>{c.titleVi}</span><span className={styles.muted}>{c.slug} · {c.priceVnd ? formatVnd(c.priceVnd) : "Chưa đặt giá"}</span></div>
              <span className={c.status === "published" ? styles.tagOk : styles.tag}>{STATUS[c.status] ?? c.status}</span>
              {canEdit && (
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => { setProblem(null); setPrice(String(c.priceVnd ?? "")); setEdit({ course: c, kind: "price" }); }}>Đổi giá</button>
                  {c.status === "published"
                    ? <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "archived" }); }}>Ngừng bán</button>
                    : <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "published" }); }}>Mở bán</button>}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      <ActionDialog open={edit?.kind === "price"} title={`Đổi giá “${edit?.course.titleVi ?? ""}”`} confirmLabel={newPrice > 0 ? `Đổi thành ${formatVnd(newPrice)}` : "Đổi giá"} busy={busy} problem={problem} onClose={() => setEdit(null)} onConfirm={() => void save()}>
        <p className={styles.muted}>Giá hiện tại: {edit?.course.priceVnd ? formatVnd(edit.course.priceVnd) : "chưa đặt"}. Đơn đã tạo giữ nguyên giá cũ.</p>
        <Field label="Giá mới (đồng) *"><input className={styles.input} required type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </ActionDialog>
      <ActionDialog open={edit?.kind === "published" || edit?.kind === "archived"} title={`${edit?.kind === "published" ? "Mở bán" : "Ngừng bán"} “${edit?.course.titleVi ?? ""}”?`} confirmLabel={edit?.kind === "published" ? "Mở bán" : "Ngừng bán"} danger={edit?.kind === "archived"} busy={busy} problem={problem} onClose={() => setEdit(null)} onConfirm={() => void save()}>
        <p className={styles.muted}>Giá: {edit?.course.priceVnd ? formatVnd(edit.course.priceVnd) : "chưa đặt"}.</p>
      </ActionDialog>
    </>
  );
}
