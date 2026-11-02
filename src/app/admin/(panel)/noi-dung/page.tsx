"use client";

import Link from "next/link";
import { useState } from "react";
import { adminUpload, can, Field, messageFor, useAdmin } from "../admin-lib";
import styles from "../admin.module.css";

// Chủ tải gói học liệu (.zip/.json) hoặc ngân hàng câu hỏi Word (.docx), xem trước rồi nhập. Khóa mới luôn ở dạng nháp.

type Course = { slug: string; titleVi: string; lessons: number; existed: boolean; status: string; newVersion: boolean; live: boolean };
type Preview = { file: string; sources: string[]; skipped: number; courses: Course[]; newLessonVersions: number; needsConfirm: string[]; receipt: string };

const MAX_BYTES = 16 * 1024 * 1024;

function courseState(c: Course): { text: string; tag: string } {
  if (!c.existed) return { text: "Khóa mới (nháp)", tag: styles.tagOk };
  if (!c.newVersion) return { text: "Không đổi", tag: styles.tag };
  return c.live ? { text: "Đang bán · nội dung sẽ đổi", tag: styles.tagBad } : { text: "Có nội dung mới", tag: styles.tagWarn };
}

export default function ContentImportPage() {
  const me = useAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (me && !can(me, "content.edit")) return <p className={styles.notice}>Chỉ chủ tài khoản được nhập nội dung khóa học.</p>;

  const path = (apply: boolean) => `/api/quan-tri/content/import?${new URLSearchParams({ file: file!.name, ...(apply ? { apply: "1" } : {}), ...(apply && confirmLive ? { confirmLive: "1" } : {}) })}`;

  function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setDone(null);
    setConfirmLive(false);
    setProblem(f && f.size > MAX_BYTES ? "Tệp lớn hơn 16 MB." : null);
  }

  async function runPreview() {
    if (!file) return;
    setBusy("preview");
    setProblem(null);
    setDone(null);
    const r = await adminUpload<Preview>(path(false), file);
    setBusy(null);
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setPreview(r.data);
    setConfirmLive(false);
  }

  async function runApply() {
    if (!file || !preview) return;
    setBusy("apply");
    setProblem(null);
    const r = await adminUpload<Preview>(path(true), file, { "x-preview-receipt": preview.receipt });
    setBusy(null);
    if (!r.ok) {
      if (r.data.error === "stale_preview") setPreview(null);
      return setProblem(messageFor(r.data.error));
    }
    setDone(`Đã nhập ${r.data.courses.length} khóa, ${r.data.newLessonVersions} phiên bản bài mới.`);
    setPreview(null);
  }

  const changes = preview?.courses.some((c) => c.newVersion) ?? false;

  return (
    <>
      <h1 className={styles.h1}>Nhập nội dung</h1>
      <section className={styles.card}>
        <p className={styles.muted}>
          Nhận gói học liệu <b>.zip</b> hoặc <b>.json</b> (như gói Oiler, Wiper, Engine Cadet) và ngân hàng câu hỏi <b>.docx</b> (chỉ có câu hỏi tiếng Anh và câu hỏi phụ, chưa có đáp án). Tối đa 16 MB.
          Khóa mới vào dạng nháp: đặt giá và mở bán ở mục <Link href="/admin/khoa-hoc">Khóa học</Link> khi đã duyệt nội dung.
        </p>
        <Field label="Tệp nội dung">
          <input className={styles.input} type="file" accept=".zip,.json,.docx" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </Field>
        <div className={styles.actions}>
          <button className={styles.btnMain} disabled={!file || !!busy || (file?.size ?? 0) > MAX_BYTES} onClick={() => void runPreview()}>
            {busy === "preview" ? "Đang đọc tệp…" : "Xem trước"}
          </button>
        </div>
        {problem && <p className={styles.error} role="alert">{problem}</p>}
        {done && <p className={styles.ok} role="status">{done} <Link href="/admin/khoa-hoc">Xem các khóa</Link></p>}
      </section>

      {preview && (
        <section className={styles.card} aria-label="Kết quả xem trước">
          <h2 className={styles.h2}>Xem trước: {preview.file}</h2>
          <p className={styles.muted}>
            Đọc được {preview.sources.length} bộ dữ liệu{preview.skipped ? `, bỏ qua ${preview.skipped} tệp khác (PDF, Word, hướng dẫn…)` : ""}. Phiên bản bài mới: {preview.newLessonVersions}.
          </p>
          {preview.courses.map((c) => {
            const s = courseState(c);
            return (
              <div key={c.slug} className={styles.item}>
                <div className={styles.itemText}><span>{c.titleVi}</span><span className={styles.muted}>{c.slug} · {c.lessons} bài</span></div>
                <span className={s.tag}>{s.text}</span>
              </div>
            );
          })}
          {preview.needsConfirm.length > 0 && (
            <label className={styles.notice}>
              <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />{" "}
              Tôi hiểu: học viên đang học {preview.needsConfirm.length} khóa đang bán sẽ thấy nội dung mới ở lần mở bài sau. Tiến độ học được giữ.
            </label>
          )}
          <div className={styles.actions}>
            <button className={styles.btnMain} disabled={!changes || !!busy || (preview.needsConfirm.length > 0 && !confirmLive)} onClick={() => void runApply()}>
              {busy === "apply" ? "Đang nhập…" : changes ? "Nhập vào hệ thống" : "Không có gì mới để nhập"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
