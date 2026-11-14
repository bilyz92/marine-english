"use client";

import { useState } from "react";
import { ActionDialog, adminApi, csrf, Field, problemOf, type ApiResult } from "../admin-lib";
import styles from "../admin.module.css";

// Danh mục khóa học (docs/superpowers/plans/2026-11-14-course-categories.md, Task 3): cây 2 cấp, sửa tên tại chỗ, ↑ ↓, xóa khi rỗng,
// danh mục con, tên tiếng Anh và ảnh đại diện (ảnh chỉ hiện ở ô danh mục cấp 1 của trang công khai).

export type Category = { id: string; parentId: string | null; titleVi: string; titleEn: string | null; imageUrl: string | null; position: number; courseCount: number };

/** Lựa chọn danh mục cho ô chọn của khóa: danh mục con thụt lề dưới cha. */
export function categoryOptions(categories: Category[]) {
  return categories.map((c) => ({ value: c.id, label: c.parentId ? `   — ${c.titleVi}` : c.titleVi }));
}

async function uploadImage(id: string, file: File): Promise<ApiResult<{ imageUrl: string }>> {
  if (file.size > 2 * 1024 * 1024) return { ok: false, status: 413, data: { error: "image_too_large" } as never };
  const res = await fetch(`/api/quan-tri/categories/${id}/image`, { method: "PUT", headers: { "content-type": "application/octet-stream", ...csrf() }, body: file }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: { error: "Không kết nối được, kiểm tra mạng." } as never };
  if (res.status === 413) return { ok: false, status: 413, data: { error: "image_too_large" } as never };
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export function CategoriesPanel({ categories, canEdit, onChanged }: { categories: Category[]; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ titleVi: "", titleEn: "" });
  const [names, setNames] = useState<Record<string, { titleVi: string; titleEn: string }>>({});
  const [childOf, setChildOf] = useState<Category | null>(null);
  const [childName, setChildName] = useState("");
  const [childProblem, setChildProblem] = useState<string | null>(null);

  async function run(call: () => Promise<ApiResult<unknown>>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    const r = await call();
    setBusy(false);
    const issue = problemOf(r);
    if (issue) {
      setProblem(issue);
      return false;
    }
    await onChanged();
    return true;
  }
  const nameOf = (c: Category) => names[c.id] ?? { titleVi: c.titleVi, titleEn: c.titleEn ?? "" };
  const setName = (c: Category, patch: Partial<{ titleVi: string; titleEn: string }>) => setNames({ ...names, [c.id]: { ...nameOf(c), ...patch } });
  const changed = (c: Category) => nameOf(c).titleVi !== c.titleVi || nameOf(c).titleEn !== (c.titleEn ?? "");

  async function saveName(c: Category) {
    const { titleVi, titleEn } = nameOf(c);
    if (await run(() => adminApi(`/api/quan-tri/categories/${c.id}`, { method: "PATCH", body: { titleVi, titleEn: titleEn.trim() ? titleEn : null } }))) {
      const { [c.id]: _done, ...rest } = names;
      setNames(rest);
    }
  }
  async function create() {
    const body = { titleVi: draft.titleVi, titleEn: draft.titleEn.trim() ? draft.titleEn : null };
    if (await run(() => adminApi("/api/quan-tri/categories", { method: "POST", body }))) setDraft({ titleVi: "", titleEn: "" });
  }
  async function createChild() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/categories", { method: "POST", body: { titleVi: childName, parentId: childOf!.id } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setChildProblem(issue);
    setChildOf(null);
    await onChanged();
  }

  const row = (c: Category) => {
    const label = c.titleVi;
    return (
      <li key={c.id} className={styles.item} style={c.parentId ? { paddingLeft: 24 } : undefined}>
        {canEdit ? (
          <div className={styles.itemText} style={{ gap: 6 }}>
            <input className={styles.input} aria-label={`Tên danh mục ${label}`} value={nameOf(c).titleVi} onChange={(e) => setName(c, { titleVi: e.target.value })} />
            <input className={styles.input} aria-label={`Tên tiếng Anh của ${label}`} placeholder="Tên tiếng Anh (không bắt buộc)" value={nameOf(c).titleEn} onChange={(e) => setName(c, { titleEn: e.target.value })} />
            <span className={styles.muted}>{c.parentId ? "Danh mục con" : `Danh mục ${c.position}`} · {c.courseCount} khóa</span>
          </div>
        ) : (
          <div className={styles.itemText}>
            <span>{c.titleEn ? `${c.titleEn} – ${c.titleVi}` : c.titleVi}</span>
            <span className={styles.muted}>{c.parentId ? "Danh mục con" : `Danh mục ${c.position}`} · {c.courseCount} khóa</span>
          </div>
        )}
        {!c.parentId && c.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước của danh mục (công khai, nhỏ)
          <img src={c.imageUrl} alt={`Ảnh hiện tại của ${label}`} width={96} height={86} style={{ objectFit: "cover", borderRadius: 6 }} />
        )}
        {canEdit && (
          <div className={styles.actions}>
            {changed(c) && <button className={styles.btnMain} disabled={busy} aria-label={`Lưu tên ${label}`} onClick={() => void saveName(c)}>Lưu tên</button>}
            <button className={styles.btn} disabled={busy} aria-label={`Lên: ${label}`} onClick={() => void run(() => adminApi(`/api/quan-tri/categories/${c.id}`, { method: "PATCH", body: { move: "up" } }))}>↑</button>
            <button className={styles.btn} disabled={busy} aria-label={`Xuống: ${label}`} onClick={() => void run(() => adminApi(`/api/quan-tri/categories/${c.id}`, { method: "PATCH", body: { move: "down" } }))}>↓</button>
            {!c.parentId && (
              <>
                <button className={styles.btn} disabled={busy} aria-label={`Thêm danh mục con vào ${label}`} onClick={() => { setChildName(""); setChildProblem(null); setChildOf(c); }}>Thêm danh mục con</button>
                <label className={styles.fileBtn} aria-disabled={busy}>
                  Tải ảnh
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label={`Tải ảnh cho ${label}`}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => uploadImage(c.id, f)); }} />
                </label>
                {c.imageUrl && <button className={styles.btn} disabled={busy} aria-label={`Gỡ ảnh của ${label}`} onClick={() => void run(() => adminApi(`/api/quan-tri/categories/${c.id}/image`, { method: "DELETE", body: {} }))}>Gỡ ảnh</button>}
              </>
            )}
            <button className={styles.btn} disabled={busy} aria-label={`Xóa: ${label}`} onClick={() => void run(() => adminApi(`/api/quan-tri/categories/${c.id}`, { method: "DELETE", body: {} }))}>Xóa</button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className={styles.card} aria-labelledby="h-danh-muc">
      <h2 id="h-danh-muc" className={styles.h2}>Danh mục</h2>
      <p className={styles.muted}>Trang Khóa học gom khóa theo danh mục cấp 1 (theo thứ tự ở đây). Danh mục con hiện thành nhóm nhỏ bên trong. Ảnh: jpg, png hoặc webp, tối đa 2 MB.</p>
      {categories.length === 0 && <p className={styles.muted}>Chưa có danh mục. Mọi khóa đang hiện ở nhóm “Khóa khác”.</p>}
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{categories.map(row)}</ul>
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {canEdit && (
        <form className={styles.actions} style={{ alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="Tên danh mục mới"><input className={styles.input} required value={draft.titleVi} onChange={(e) => setDraft({ ...draft, titleVi: e.target.value })} /></Field>
          <Field label="Tên tiếng Anh"><input className={styles.input} value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} /></Field>
          <button type="submit" className={styles.btnMain} disabled={busy}>Thêm danh mục</button>
        </form>
      )}
      <ActionDialog open={childOf !== null} title={`Thêm danh mục con vào “${childOf?.titleVi ?? ""}”`} confirmLabel="Thêm danh mục con" busy={busy} problem={childProblem} onClose={() => setChildOf(null)} onConfirm={() => void createChild()}>
        <Field label="Tên danh mục con *"><input className={styles.input} required value={childName} onChange={(e) => setChildName(e.target.value)} /></Field>
      </ActionDialog>
    </section>
  );
}
