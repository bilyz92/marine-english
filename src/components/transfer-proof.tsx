"use client";

import { useRef, useState } from "react";
import { learnerCsrfHeader } from "@/lib/client/api";
import styles from "./transfer-proof.module.css";

// Khách bị khóa lại (chủ chưa thấy tiền) gửi ảnh chụp màn hình chuyển khoản để chủ kiểm lại.

const MAX_SIDE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;

const ERRORS: Record<string, string> = {
  too_many_proofs: "Đơn này đã gửi đủ 5 ảnh. Chủ khóa học sẽ xem và trả lời.",
  not_claimed: "Đơn này chưa báo chuyển khoản.",
};

/** Thu nhỏ ảnh trên máy (ảnh điện thoại thường 3–8 MB) thành JPEG cạnh dài tối đa 1600 px. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function TransferProof({ code, onSent }: { code: string; onSent?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!file) return setProblem("Chọn ảnh chụp màn hình chuyển khoản.");
    setBusy(true);
    setProblem(null);
    const image = await shrink(file);
    if (image.size > MAX_BYTES) {
      setBusy(false);
      return setProblem("Ảnh quá lớn. Chụp lại màn hình rồi gửi ảnh đó.");
    }
    const form = new FormData();
    form.set("image", image, "chuyen-khoan.jpg");
    form.set("message", message);
    const res = await fetch(`/api/me/orders/${encodeURIComponent(code)}/proof`, { method: "POST", body: form, headers: learnerCsrfHeader() }).catch(() => null);
    setBusy(false);
    if (!res) return setProblem("Mất kết nối. Thử lại khi có mạng.");
    if (!res.ok) {
      const error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "";
      return setProblem(ERRORS[error] ?? (res.status === 400 ? error || "Ảnh không hợp lệ." : "Chưa gửi được. Thử lại sau."));
    }
    setSent(true);
    setFile(null);
    setMessage("");
    onSent?.();
  }

  return (
    <>
      <button type="button" className={styles.open} onClick={() => { setSent(false); setProblem(null); dialog.current?.showModal(); }}>
        Gửi ảnh chứng minh đã chuyển khoản
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={`proof-${code}`}>
        <h2 id={`proof-${code}`} className={styles.title}>Gửi bằng chứng đã chuyển khoản</h2>
        {sent ? (
          <p className={styles.ok} role="status">Đã gửi. Chủ khóa học sẽ kiểm tra và mở lại khóa học khi thấy tiền.</p>
        ) : (
          <>
            <p className={styles.lead}>Đơn {code}. Chụp màn hình giao dịch trong app ngân hàng (thấy số tiền, giờ chuyển và nội dung).</p>
            <label className={styles.field}>
              <span>Ảnh chuyển khoản</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className={styles.field}>
              <span>Lời nhắn (không bắt buộc)</span>
              <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ví dụ: chuyển lúc 9h sáng từ BIDV" />
            </label>
            {problem && <p className={styles.error} role="alert">{problem}</p>}
          </>
        )}
        <div className={styles.actions}>
          {!sent && <button type="button" className={styles.send} disabled={busy} onClick={() => void send()}>{busy ? "Đang gửi…" : "Gửi ảnh"}</button>}
          <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>Đóng</button>
        </div>
      </dialog>
    </>
  );
}
