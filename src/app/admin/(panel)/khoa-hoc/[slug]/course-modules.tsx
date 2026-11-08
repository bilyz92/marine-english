"use client";

import { useState } from "react";
import { adminApi, Field, messageFor } from "../../admin-lib";
import styles from "../../admin.module.css";

// Khối "Module" ở trang khóa (docs/superpowers/plans/2026-11-08-course-modules.md, Task 5): chủ đặt tên, sắp xếp, thêm, xóa module rỗng.

export type CourseModule = { id: string; titleVi: string };

type Props = {
  slug: string;
  modules: CourseModule[];
  lessonCount: (moduleId: string) => number;
  canEdit: boolean;
  /** Sau mỗi thao tác thành công: tải lại trang khóa và báo cho chủ. */
  onChanged: (message: string) => Promise<void>;
};

export function CourseModules({ slug, modules, lessonCount, canEdit, onChanged }: Props) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const base = `/api/quan-tri/content/courses/${slug}/modules`;

  async function act(request: Promise<{ ok: boolean; data: { error?: string } }>, message: string) {
    setBusy(true);
    setProblem(null);
    const r = await request;
    if (r.ok) await onChanged(message);
    else setProblem(messageFor(r.data.error));
    setBusy(false);
    return r.ok;
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const title = newName.trim();
    if (!title) return;
    const first = modules.length === 0;
    if (await act(adminApi(base, { method: "POST", body: { titleVi: title } }), first ? `Đã tạo module “${title}”, mọi bài hiện có đã vào module này.` : `Đã tạo module “${title}”.`)) setNewName("");
  }

  async function rename(m: CourseModule) {
    const title = (names[m.id] ?? m.titleVi).trim();
    if (await act(adminApi(`${base}/${m.id}`, { method: "PATCH", body: { titleVi: title } }), `Đã đổi tên module thành “${title}”.`)) {
      setNames(({ [m.id]: _, ...rest }) => rest);
    }
  }

  return (
    <section className={styles.card} aria-label="Module">
      <h2 className={styles.h2}>Module</h2>
      {modules.length === 0 && <p className={styles.muted}>Chưa chia module. Tạo module đầu tiên: mọi bài hiện có sẽ vào module này.</p>}
      {modules.map((m, i) => {
        const name = names[m.id] ?? m.titleVi;
        const count = lessonCount(m.id);
        return (
          <div key={m.id} className={styles.item}>
            <div className={styles.itemText}>
              {canEdit ? (
                <Field label={`Tên module ${i + 1}`}>
                  <input className={styles.input} value={name} maxLength={120} onChange={(e) => setNames({ ...names, [m.id]: e.target.value })} />
                </Field>
              ) : <span>Module {i + 1} · {m.titleVi}</span>}
              <span className={styles.muted}>{count} bài</span>
            </div>
            {canEdit && (
              <div className={styles.actions}>
                {name.trim() !== m.titleVi && <button className={styles.btn} disabled={busy || !name.trim()} onClick={() => void rename(m)}>Lưu tên</button>}
                <button className={styles.btn} aria-label={`Đưa lên: ${m.titleVi}`} disabled={busy || i === 0}
                  onClick={() => void act(adminApi(`${base}/${m.id}`, { method: "PATCH", body: { move: "up" } }), `Đã đưa “${m.titleVi}” lên.`)}>↑</button>
                <button className={styles.btn} aria-label={`Đưa xuống: ${m.titleVi}`} disabled={busy || i === modules.length - 1}
                  onClick={() => void act(adminApi(`${base}/${m.id}`, { method: "PATCH", body: { move: "down" } }), `Đã đưa “${m.titleVi}” xuống.`)}>↓</button>
                <button className={styles.btn} aria-label={`Xóa module: ${m.titleVi}`} disabled={busy}
                  onClick={() => void act(adminApi(`${base}/${m.id}`, { method: "DELETE", body: {} }), `Đã xóa module “${m.titleVi}”.`)}>Xóa</button>
              </div>
            )}
          </div>
        );
      })}
      {canEdit && (
        <form className={styles.form} onSubmit={(e) => void add(e)}>
          <Field label="Tên module mới"><input className={styles.input} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder="Ví dụ: Kinh nghiệm phỏng vấn" /></Field>
          <div className={styles.actions}><button className={styles.btn} disabled={busy || !newName.trim()}>Thêm module</button></div>
        </form>
      )}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
    </section>
  );
}
