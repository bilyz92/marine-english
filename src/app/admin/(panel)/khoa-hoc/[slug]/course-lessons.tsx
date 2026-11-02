"use client";

import Link from "next/link";
import { use, useState } from "react";
import { adminApi, can, Field, LoadState, messageFor, useAdmin, useLoad } from "../../admin-lib";
import styles from "../../admin.module.css";

// Danh sách bài của phiên bản hiện tại; chủ sửa bài hoặc thêm bài cuối khóa. Mỗi lần lưu tạo phiên bản mới.

type Row = { position: number; externalId: string; questionEn: string; questionVi: string; isFreeTrial: boolean; hasAnswer: boolean };
type Listing = { course: { slug: string; titleVi: string; status: string; currentVersionId: string | null }; lessons: Row[] };
type Pair = { id?: string; en: string; vi: string };
type Form = { questionEn: string; questionVi: string; keyPoints: Pair[]; vocabulary: Pair[]; modelAnswerEn: string; modelAnswerVi: string; followUps: Pair[] };
type Bi = { en?: string; vi?: string };

const EMPTY: Form = { questionEn: "", questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [] };
const pairOf = (t: Bi | undefined, id?: unknown): Pair => ({ ...(typeof id === "string" ? { id } : {}), en: t?.en ?? "", vi: t?.vi ?? "" });

function formOf(c: Record<string, unknown>): Form {
  const list = (key: string) => ((c[key] as Record<string, unknown>[] | undefined) ?? []);
  return {
    questionEn: pairOf((c.question as { text?: Bi })?.text).en,
    questionVi: pairOf((c.question as { text?: Bi })?.text).vi,
    // Giữ mã từng mục để máy chủ ghép đúng dữ liệu kèm theo khi bỏ hoặc thêm mục.
    keyPoints: list("key_points").map((k) => pairOf(k.text as Bi, k.id)),
    // Từ vựng có hai dạng: {text:{en,vi}} (Engine Cadet) hoặc {en,vi} (Oiler, Wiper).
    vocabulary: list("vocabulary").map((v) => pairOf((v.text as Bi | undefined) ?? (v as Bi))),
    modelAnswerEn: pairOf((c.model_answer as { text?: Bi })?.text).en,
    modelAnswerVi: pairOf((c.model_answer as { text?: Bi })?.text).vi,
    followUps: list("follow_up_questions").map((q) => pairOf(q.prompt as Bi, q.id)),
  };
}

function Pairs({ label, items, onChange, addLabel }: { label: string; items: Pair[]; onChange: (p: Pair[]) => void; addLabel: string }) {
  const set = (i: number, key: keyof Pair, value: string) => onChange(items.map((p, j) => (j === i ? { ...p, [key]: value } : p)));
  return (
    <fieldset className={styles.form}>
      <legend className={styles.h2}>{label}</legend>
      {items.map((p, i) => (
        <div key={p.id ?? `new-${i}`} className={styles.item}>
          <Field label={`${label} ${i + 1} · tiếng Anh`}><input className={styles.input} value={p.en} onChange={(e) => set(i, "en", e.target.value)} /></Field>
          <Field label={`${label} ${i + 1} · tiếng Việt`}><input className={styles.input} value={p.vi} onChange={(e) => set(i, "vi", e.target.value)} /></Field>
          <button type="button" className={styles.btn} onClick={() => onChange(items.filter((_, j) => j !== i))}>Bỏ</button>
        </div>
      ))}
      <button type="button" className={styles.btn} onClick={() => onChange([...items, { en: "", vi: "" }])}>{addLabel}</button>
    </fieldset>
  );
}

export function CourseLessons({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<Listing>(`/api/quan-tri/content/courses/${slug}`);
  const [editing, setEditing] = useState<{ externalId: string | null; form: Form } | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const canEdit = can(me, "content.edit");
  const live = data?.course.status === "published";

  async function open(externalId: string | null) {
    setProblem(null);
    setSaved(null);
    setConfirmLive(false);
    if (!externalId) return setEditing({ externalId: null, form: EMPTY });
    const r = await adminApi<{ content: Record<string, unknown> }>(`/api/quan-tri/content/courses/${slug}/lessons/${encodeURIComponent(externalId)}`);
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setEditing({ externalId, form: formOf(r.data.content) });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !data) return;
    setBusy(true);
    setProblem(null);
    const body = { ...editing.form, expectedVersionId: data.course.currentVersionId, confirmLive };
    const r = editing.externalId
      ? await adminApi<{ externalId: string }>(`/api/quan-tri/content/courses/${slug}/lessons/${encodeURIComponent(editing.externalId)}`, { method: "PUT", body })
      : await adminApi<{ externalId: string }>(`/api/quan-tri/content/courses/${slug}/lessons`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      if (r.data.error === "stale") {
        // Bài vừa được sửa ở chỗ khác: tải lại danh sách và nội dung bài mới nhất, không lưu đè bằng form cũ.
        // Thêm bài (nối cuối khóa) không đè lên ai: giữ nội dung đang gõ, chỉ cập nhật phiên bản khóa rồi bấm lưu lại.
        await reload();
        if (editing.externalId) await open(editing.externalId);
        return setProblem(editing.externalId
          ? "Bài vừa được sửa ở chỗ khác. Đã tải bản mới nhất, sửa lại rồi lưu."
          : "Khóa vừa được sửa ở chỗ khác. Đã cập nhật, bấm Lưu bài lần nữa để thêm bài.");
      }
      return setProblem(messageFor(r.data.error));
    }
    setSaved(editing.externalId ? `Đã lưu bài ${r.data.externalId}.` : `Đã thêm bài ${r.data.externalId}.`);
    setEditing(null);
    await reload();
  }

  const setForm = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <>
      <p><Link href="/admin/khoa-hoc">← Khóa học</Link></p>
      <h1 className={styles.h1}>{data?.course.titleVi ?? slug}</h1>
      <LoadState {...state} reload={reload} />
      {saved && <p className={styles.ok} role="status">{saved}</p>}
      {data && (
        <section className={styles.card}>
          <p className={styles.muted}>
            {data.course.slug} · {data.lessons.length} bài · {live ? "Đang mở bán: học viên thấy nội dung mới ở lần mở bài sau." : "Nháp: học viên chưa thấy."}
          </p>
          {data.lessons.length === 0 && <p className={styles.muted}>Khóa chưa có bài.</p>}
          {data.lessons.map((l) => (
            <div key={l.externalId} className={styles.item}>
              <div className={styles.itemText}>
                <span>{l.position}. {l.questionVi || l.questionEn}</span>
                <span className={styles.muted}>{l.externalId}{l.isFreeTrial ? " · học thử" : ""}{l.hasAnswer ? "" : " · chưa có đáp án mẫu"}</span>
              </div>
              {canEdit && <div className={styles.actions}><button className={styles.btn} onClick={() => void open(l.externalId)}>Sửa</button></div>}
            </div>
          ))}
          {canEdit && <div className={styles.actions}><button className={styles.btnMain} onClick={() => void open(null)}>Thêm bài</button></div>}
          {!editing && problem && <p className={styles.error} role="alert">{problem}</p>}
        </section>
      )}

      {editing && (
        <form className={styles.card} onSubmit={(e) => void save(e)} aria-label="Soạn bài">
          <h2 className={styles.h2}>{editing.externalId ? `Sửa bài ${editing.externalId}` : "Thêm bài cuối khóa"}</h2>
          <p className={styles.muted}>Phần học từng câu nhỏ (Mức 1), bài tập và nguồn của bài giữ nguyên, không tự đổi theo nội dung sửa.</p>
          <Field label="Câu hỏi · tiếng Anh *"><textarea className={styles.input} required rows={2} value={editing.form.questionEn} onChange={(e) => setForm({ questionEn: e.target.value })} /></Field>
          <Field label="Câu hỏi · tiếng Việt"><textarea className={styles.input} rows={2} value={editing.form.questionVi} onChange={(e) => setForm({ questionVi: e.target.value })} /></Field>
          <Pairs label="Ý chính" items={editing.form.keyPoints} onChange={(keyPoints) => setForm({ keyPoints })} addLabel="Thêm ý chính" />
          <Pairs label="Từ vựng" items={editing.form.vocabulary} onChange={(vocabulary) => setForm({ vocabulary })} addLabel="Thêm từ" />
          <Field label="Đáp án mẫu · tiếng Anh (để trống nếu chưa có)"><textarea className={styles.input} rows={4} value={editing.form.modelAnswerEn} onChange={(e) => setForm({ modelAnswerEn: e.target.value })} /></Field>
          <Field label="Đáp án mẫu · tiếng Việt"><textarea className={styles.input} rows={4} value={editing.form.modelAnswerVi} onChange={(e) => setForm({ modelAnswerVi: e.target.value })} /></Field>
          <Pairs label="Câu hỏi phụ" items={editing.form.followUps} onChange={(followUps) => setForm({ followUps })} addLabel="Thêm câu hỏi phụ" />
          {live && (
            <label className={styles.notice}>
              <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} /> Khóa đang bán: tôi hiểu học viên sẽ thấy nội dung mới.
            </label>
          )}
          {problem && <p className={styles.error} role="alert">{problem}</p>}
          <div className={styles.actions}>
            <button className={styles.btnMain} disabled={busy || (live && !confirmLive)}>{busy ? "Đang lưu…" : "Lưu bài"}</button>
            <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Hủy</button>
          </div>
        </form>
      )}
    </>
  );
}
