"use client";

import Link from "next/link";
import { useState } from "react";
import { formatVnd } from "@/lib/format";
import { ActionDialog, adminApi, can, Field, LoadState, problemOf, useAdmin, useLoad } from "../admin-lib";
import styles from "../admin.module.css";
import { CategoriesPanel, categoryOptions, type Category } from "./categories";

type Course = { id: string; slug: string; titleVi: string; status: string; priceVnd: number | null; categoryId: string | null };
const STATUS: Record<string, string> = { draft: "Nháp", published: "Đang mở bán", archived: "Sắp ra mắt" };
const STATUS_ACTION = { published: "Mở bán", archived: "Chuyển sang Sắp ra mắt", draft: "Ẩn khỏi web" } as const;

export default function CoursesPage() {
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<{ courses: Course[] }>("/api/quan-tri/courses");
  const cats = useLoad<{ categories: Category[] }>("/api/quan-tri/categories");
  const categories = cats.data?.categories ?? [];
  const reloadAll = async () => { await Promise.all([reload(), cats.reload()]); };
  const [edit, setEdit] = useState<{ course: Course; kind: "price" | "published" | "archived" | "draft" } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ slug: "", titleVi: "", titleEn: "" });
  const [price, setPrice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [bulk, setBulk] = useState<"published" | "archived" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canEdit = can(me, "prices.edit");
  const canAuthor = can(me, "content.edit");

  async function create() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/content/courses", { method: "POST", body: draft });
    setBusy(false);
    const issue = r.data.error === "slug_taken" ? "Mã khóa này đã có." : problemOf(r);
    if (issue) return setProblem(issue);
    setCreating(false);
    await reload();
  }
  const newPrice = Number(price);

  /** Đổi danh mục của khóa là lưu ngay. */
  async function setCategory(course: Course, categoryId: string) {
    setProblem(null);
    setSaving(course.id);
    const r = await adminApi(`/api/quan-tri/courses/${course.id}/category`, { method: "PUT", body: { categoryId: categoryId || null } });
    const issue = problemOf(r);
    if (!issue) await reloadAll();
    setSaving(null);
    if (issue) setProblem(issue);
  }
  // Danh sách khóa nhóm theo danh mục (thứ tự như khối Danh mục), khóa chưa xếp ở cuối.
  const sections = data
    ? [...categories.map((c) => ({ key: c.id, title: c.parentId ? `${categories.find((p) => p.id === c.parentId)?.titleVi ?? ""} › ${c.titleVi}` : c.titleVi, courses: data.courses.filter((x) => x.categoryId === c.id) })),
       { key: "none", title: "Chưa xếp danh mục", courses: data.courses.filter((x) => !x.categoryId || !categories.some((c) => c.id === x.categoryId)) }]
        .filter((s) => s.courses.length > 0)
    : [];

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

  const statusKind = edit && edit.kind !== "price" ? edit.kind : null;
  const publishedCount = data?.courses.filter((c) => c.status === "published").length ?? 0;
  const archivedCount = data?.courses.filter((c) => c.status === "archived").length ?? 0;

  /**
   * Chuyển tất cả sang Sắp ra mắt / mở bán tất cả (chủ 24–25/11/2026): nháp không đổi; mở bán bỏ qua khóa chưa có giá hoặc chưa có bài.
   * Khóa Sắp ra mắt ('archived') vẫn hiện trên web, làm mờ, không mua được.
   */
  async function saveBulk() {
    const target = bulk;
    setBusy(true);
    const r = await adminApi<{ changed: number; skipped: number }>("/api/quan-tri/courses/bulk-status", { method: "POST", body: { status: target } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    const { changed, skipped } = r.data;
    setNote(target === "archived"
      ? `Đã chuyển ${changed} khóa sang Sắp ra mắt.`
      : `Đã mở bán ${changed} khóa.${skipped > 0 ? ` Bỏ qua ${skipped} khóa chưa có giá hoặc chưa có bài.` : ""}`);
    setBulk(null);
    await reload();
  }

  return (
    <>
      <h1 className={styles.h1}>Khóa học</h1>
      {cats.data && <CategoriesPanel categories={categories} canEdit={canAuthor} onChanged={reloadAll} />}
      <LoadState {...state} reload={reload} />
      {data && (
        <section className={styles.card}>
          {data.courses.length === 0 && <p className={styles.muted}>Chưa có khóa nào. Chủ thêm khóa ở mục Nhập nội dung.</p>}
          {canEdit && (publishedCount > 0 || archivedCount > 0) && (
            <div className={styles.actions}>
              {publishedCount > 0 && <button className={styles.btnDanger} onClick={() => { setProblem(null); setNote(null); setBulk("archived"); }}>Chuyển tất cả sang Sắp ra mắt ({publishedCount})</button>}
              {archivedCount > 0 && <button className={styles.btn} onClick={() => { setProblem(null); setNote(null); setBulk("published"); }}>Mở bán tất cả ({archivedCount})</button>}
            </div>
          )}
          {note && <p className={styles.ok} role="status">{note}</p>}
          {problem && !edit && !creating && !bulk && <p className={styles.error} role="alert">{problem}</p>}
          {sections.map((sec) => (
            <div key={sec.key} style={{ display: "contents" }}>
            <h2 className={styles.h2}>{sec.title}</h2>
          {sec.courses.map((c) => (
            <div key={c.id} className={styles.item}>
              <div className={styles.itemText}><span>{c.titleVi}</span><span className={styles.muted}>{c.slug} · {c.priceVnd ? formatVnd(c.priceVnd) : "Chưa đặt giá"}</span></div>
              <span className={c.status === "published" ? styles.tagOk : styles.tag}>{STATUS[c.status] ?? c.status}</span>
              {canAuthor && cats.data && (
                <select className={styles.input} style={{ width: "auto", maxWidth: 280 }} aria-label={`Danh mục của ${c.slug}`} disabled={saving !== null} value={c.categoryId ?? ""} onChange={(e) => void setCategory(c, e.target.value)}>
                  <option value="">Chưa xếp</option>
                  {categoryOptions(categories).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              <div className={styles.actions}><Link className={styles.btn} href={`/admin/khoa-hoc/${c.slug}`}>Bài học</Link></div>
              {canEdit && (
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => { setProblem(null); setPrice(String(c.priceVnd ?? "")); setEdit({ course: c, kind: "price" }); }}>Đổi giá</button>
                  {c.status === "published"
                    ? <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "archived" }); }}>Sắp ra mắt</button>
                    : <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "published" }); }}>Mở bán</button>}
                  {c.status === "draft" && <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "archived" }); }}>Sắp ra mắt</button>}
                  {c.status !== "draft" && <button className={styles.btn} onClick={() => { setProblem(null); setEdit({ course: c, kind: "draft" }); }}>Ẩn khỏi web</button>}
                </div>
              )}
            </div>
          ))}
            </div>
          ))}
          {canAuthor && <div className={styles.actions}><button className={styles.btnMain} onClick={() => { setProblem(null); setDraft({ slug: "", titleVi: "", titleEn: "" }); setCreating(true); }}>Tạo khóa mới</button></div>}
        </section>
      )}
      <ActionDialog open={creating} title="Tạo khóa mới (nháp)" confirmLabel="Tạo khóa" busy={busy} problem={problem} onClose={() => setCreating(false)} onConfirm={() => void create()}>
        <p className={styles.muted}>Khóa mới chưa có bài và chưa bán. Thêm bài ở trang Bài học của khóa.</p>
        <Field label="Mã khóa * (chữ thường không dấu, số, gạch dưới)"><input className={styles.input} required value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></Field>
        <Field label="Tên tiếng Việt *"><input className={styles.input} required value={draft.titleVi} onChange={(e) => setDraft({ ...draft, titleVi: e.target.value })} /></Field>
        <Field label="Tên tiếng Anh *"><input className={styles.input} required value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} /></Field>
      </ActionDialog>
      <ActionDialog open={edit?.kind === "price"} title={`Đổi giá “${edit?.course.titleVi ?? ""}”`} confirmLabel={newPrice > 0 ? `Đổi thành ${formatVnd(newPrice)}` : "Đổi giá"} busy={busy} problem={problem} onClose={() => setEdit(null)} onConfirm={() => void save()}>
        <p className={styles.muted}>Giá hiện tại: {edit?.course.priceVnd ? formatVnd(edit.course.priceVnd) : "chưa đặt"}. Đơn đã tạo giữ nguyên giá cũ.</p>
        <Field label="Giá mới (đồng) *"><input className={styles.input} required type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </ActionDialog>
      <ActionDialog open={statusKind !== null} title={`${STATUS_ACTION[statusKind ?? "published"]} “${edit?.course.titleVi ?? ""}”?`} confirmLabel={STATUS_ACTION[statusKind ?? "published"]} danger={edit?.kind === "archived" || edit?.kind === "draft"} busy={busy} problem={problem} onClose={() => setEdit(null)} onConfirm={() => void save()}>
        <p className={styles.muted}>
          {edit?.kind === "published" && <>Giá: {edit.course.priceVnd ? formatVnd(edit.course.priceVnd) : "chưa đặt"}. </>}
          {edit?.kind === "archived" && "Khóa vẫn hiện trên web, làm mờ, ghi “Sắp ra mắt”, không mua được. "}
          {edit?.kind === "draft" && "Khóa không còn hiện trên web. "}
          {edit?.kind !== "published" && "Người đã mua vẫn học bình thường."}
        </p>
      </ActionDialog>
      <ActionDialog open={bulk !== null} title={bulk === "archived" ? `Chuyển ${publishedCount} khóa sang Sắp ra mắt?` : `Mở bán ${archivedCount} khóa?`} confirmLabel={bulk === "archived" ? "Chuyển sang Sắp ra mắt" : "Mở bán tất cả"} danger={bulk === "archived"} busy={busy} problem={problem} onClose={() => { if (!busy) { setBulk(null); setProblem(null); } }} onConfirm={() => void saveBulk()}>
        <p className={styles.muted}>
          {bulk === "archived"
            ? "Mọi khóa đang mở bán chuyển sang Sắp ra mắt: vẫn hiện trên web, làm mờ, không ai mua mới được."
            : "Mọi khóa Sắp ra mắt sẽ mở bán lại; khóa chưa có giá hoặc chưa có bài được bỏ qua."}
          {" "}Khóa nháp giữ nguyên. Người đã mua vẫn học bình thường.
        </p>
      </ActionDialog>
    </>
  );
}
