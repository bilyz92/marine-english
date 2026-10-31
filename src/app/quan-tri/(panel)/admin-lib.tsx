"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";

export type AdminMe = { email: string; role: string; permissions: string[] };
export const AdminContext = createContext<AdminMe | null>(null);
export const useAdmin = () => useContext(AdminContext);
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
  already_settled: "Giao dịch này đã được xử lý.",
  invalid_transition: "Yêu cầu không ở bước cho phép làm thao tác này.",
  duplicate_out_ref: "Mã giao dịch chuyển trả này đã được dùng.",
  self_entered: "Người nhập dòng sao kê không được tự xác minh.",
  already_verified: "Dòng này đã được xác minh.",
  not_found: "Không tìm thấy.",
  not_verified: "Giao dịch chưa được xác minh.",
  order_refunded: "Đơn đã hoàn tiền.",
  order_paid: "Đơn đã thanh toán.",
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
  if (res.status === 401) window.location.assign(`/quan-tri/dang-nhap`);
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
    setState({ data: r.ok ? r.data : null, error: r.ok || r.status === 403 ? null : messageFor(r.data.error), forbidden: r.status === 403, loading: false });
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
