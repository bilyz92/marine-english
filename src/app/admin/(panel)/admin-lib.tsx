"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";

export type AdminMe = { email: string; role: string; permissions: string[]; hasPassword?: boolean; features?: { refunds: boolean } };
export const AdminContext = createContext<AdminMe | null>(null);
export const useAdmin = () => useContext(AdminContext);
/** Tải lại thông tin quản trị đang đăng nhập (ví dụ sau khi đặt mật khẩu). */
export const AdminReloadContext = createContext<() => void>(() => {});
export const can = (me: AdminMe | null, permission: string) => Boolean(me?.permissions.includes(permission));

function csrf(): Record<string, string> {
  const token = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_admin="))?.split("=")[1] ?? "";
  return { "x-csrf-token": token };
}

const MESSAGES: Record<string, string> = {
  role: "Tài khoản của bạn không có quyền làm việc này.",
  condition: "Bạn không có quyền với mục này.",
  reauth_required: "Vì an toàn, cần đăng nhập lại trong 10 phút gần đây mới làm được việc này.",
  last_owner: "Không thể đổi: đây là tài khoản chủ cuối cùng.",
  needs_price: "Cần đặt giá trước khi mở bán.",
  invalid: "Hai tài khoản này không gộp được.",
  no_password_login: "Học viên chưa có đăng nhập bằng số: nhập số điện thoại để gắn.",
  phone_taken: "Số này đã thuộc tài khoản khác.",
  invalid_phone: "Số điện thoại không đúng.",
  password_conflict: "Cả hai tài khoản đều có đăng nhập bằng số + mật khẩu nên chưa gộp được. Báo kỹ thuật để xử lý.",
  already_settled: "Giao dịch này đã được xử lý.",
  invalid_transition: "Yêu cầu không ở bước cho phép làm thao tác này.",
  duplicate_out_ref: "Mã giao dịch chuyển trả này đã được dùng.",
  self_entered: "Người nhập dòng sao kê không được tự xác minh.",
  already_verified: "Dòng này đã được xác minh.",
  not_found: "Không tìm thấy.",
  not_verified: "Giao dịch chưa được xác minh.",
  order_refunded: "Đơn đã hoàn tiền.",
  order_paid: "Đơn đã thanh toán.",
  missing_payout: "Chưa có tài khoản nhận tiền của học viên: nhập trước khi duyệt.",
  active_full_refund: "Đơn này đã có yêu cầu hoàn tiền đang mở.",
  not_paid: "Đơn chưa thanh toán hoặc đã hoàn.",
  stale_preview: "Dữ liệu đã đổi hoặc bản xem trước đã quá 15 phút. Bấm Xem trước lại.",
  needs_confirm: "Có khóa đang bán sẽ đổi nội dung: tích ô xác nhận rồi làm lại.",
  stale: "Bài hoặc khóa vừa được sửa ở chỗ khác. Tải lại rồi làm lại.",
  busy: "Đang có thao tác nội dung khác, thử lại sau ít giây.",
  module_not_empty: "Module còn bài: chuyển các bài sang module khác rồi mới xóa được.",
  module_required: "Chọn module cho bài mới.",
  essay_needs_answer: "Bài tự luận cần có đáp án mẫu tiếng Anh.",
};
export const messageFor = (code: unknown) => (typeof code === "string" && MESSAGES[code]) || (typeof code === "string" && code) || "Có lỗi, thử lại sau.";

export type ApiResult<T> = { ok: boolean; status: number; data: T & { error?: string; result?: string; reason?: string } };

export async function adminApi<T = Record<string, never>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? {} : { "content-type": "application/json", ...csrf() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: { error: "Không kết nối được, kiểm tra mạng." } as never };
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- phiên hết hạn: tải lại toàn trang để bỏ trạng thái cũ.
  if (res.status === 401) window.location.assign(`/admin/dang-nhap`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Gửi tệp (bytes thô) tới API quản trị, ví dụ gói nội dung. */
export async function adminUpload<T>(path: string, file: Blob, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/octet-stream", ...csrf(), ...headers }, body: file }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: { error: "Không kết nối được, kiểm tra mạng." } as never };
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- phiên hết hạn: tải lại toàn trang để bỏ trạng thái cũ.
  if (res.status === 401) window.location.assign(`/admin/dang-nhap`);
  if (res.status === 413) return { ok: false, status: 413, data: { error: "Tệp lớn hơn 16 MB." } as never };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Gửi form nhiều phần (tệp kèm trường khác) tới API quản trị. */
export async function adminForm<T>(path: string, form: FormData): Promise<ApiResult<T>> {
  const res = await fetch(path, { method: "POST", headers: csrf(), body: form }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: { error: "Không kết nối được, kiểm tra mạng." } as never };
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- phiên hết hạn: tải lại toàn trang để bỏ trạng thái cũ.
  if (res.status === 401) window.location.assign(`/admin/dang-nhap`);
  if (res.status === 413) return { ok: false, status: 413, data: { error: "Tệp quá lớn." } as never };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Lỗi cần hiển thị của kết quả ghi, kể cả trường hợp API trả 200 kèm result “rejected”. */
export function problemOf(r: ApiResult<unknown>): string | null {
  if (r.ok && r.data.result !== "rejected") return null;
  return messageFor(r.data.reason ?? r.data.error ?? r.data.result);
}

/** Đọc dữ liệu cho một màn, gồm đủ trạng thái đang tải, lỗi, không có quyền. */
export function useLoad<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; forbidden: boolean; loading: boolean }>({ data: null, error: null, forbidden: false, loading: true });
  // Đổi bộ lọc nhanh: chỉ giữ kết quả của lần gọi mới nhất.
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++latest.current;
    const r = await adminApi<T>(path);
    if (id !== latest.current) return;
    // Mục nhạy cảm cần đăng nhập gần đây: chủ vẫn có quyền, báo đúng lý do thay vì "không có quyền".
    const forbidden = r.status === 403 && r.data.error !== "reauth_required";
    setState({ data: r.ok ? r.data : null, error: r.ok || forbidden ? null : messageFor(r.data.error), forbidden, loading: false });
  }, [path]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return { ...state, reload: load };
}

export function LoadState({ loading, error, forbidden, reload }: { loading: boolean; error: string | null; forbidden: boolean; reload: () => void }) {
  if (loading) return <p className={styles.muted}>Đang tải…</p>;
  if (forbidden) return <p className={styles.notice}>Tài khoản của bạn không có quyền xem mục này.</p>;
  if (error) return <div className={styles.error}><p>{error}</p><button className={styles.btn} onClick={reload}>Thử lại</button></div>;
  return null;
}

/** Hộp xác nhận bằng dialog gốc: giữ focus bên trong, Escape đóng, focus trả về nút đã mở. */
export function ActionDialog({ open, title, confirmLabel, danger, busy, problem, onClose, onConfirm, children }: {
  open: boolean; title: string; confirmLabel: string; danger?: boolean; busy?: boolean; problem?: string | null;
  onClose: () => void; onConfirm: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby="dialog-title">
      {open && (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
          <h2 id="dialog-title" className={styles.h2}>{title}</h2>
          {children}
          {problem && <p className={styles.error} role="alert">{problem}</p>}
          <div className={styles.actions}>
            <button type="submit" className={danger ? styles.btnDanger : styles.btnMain} disabled={busy}>{busy ? "Đang xử lý…" : confirmLabel}</button>
            <button type="button" className={styles.btn} onClick={onClose}>Hủy</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

export const fmtTime = (value: string | Date | null) => (value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }) : "—");

export const ORDER_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Chờ thanh toán", className: styles.tagWarn! },
  paid: { label: "Đã thanh toán", className: styles.tagOk! },
  expired: { label: "Hết hạn", className: styles.tag! },
  refunded: { label: "Đã hoàn tiền", className: styles.tagBad! },
};

export const QUEUE_REASON: Record<string, string> = {
  no_code: "Không có mã đơn", multi_code: "Nhiều mã đơn", unknown_code: "Mã đơn không tồn tại", amount_short: "Thiếu tiền", amount_over: "Thừa tiền",
  late: "Tiền về sau hạn", early: "Tiền về trước khi tạo đơn", order_paid: "Đơn đã thanh toán", order_refunded: "Đơn đã hoàn tiền", bad_time: "Thời điểm không hợp lệ", unverified: "Chờ xác minh",
};
