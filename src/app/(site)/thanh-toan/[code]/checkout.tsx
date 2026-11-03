"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import styles from "./checkout.module.css";

type Order = {
  code: string;
  status: "pending" | "paid" | "expired" | "refunded";
  amountDueVnd: number;
  expiresAt: string;
  serverNow: string;
  courseSlug: string;
  courseTitleVi: string;
  enrolled: boolean;
  needsManual: boolean;
  paymentUnavailable: boolean;
  payment: { bankName: string; accountNo: string; accountName: string; qrImageUrl: string | null; qrPayload: string | null; autoConfirm: boolean } | null;
};

const POLL_OPEN_MS = 5_000;
// Đơn đã hết hạn vẫn hỏi tiếp, thưa hơn: tiền chuyển trong hạn có thể báo về muộn và đơn vẫn thành đã thanh toán.
const POLL_EXPIRED_MS = 30_000;

function CopyRow({ label, value, shown, hint, accent }: { label: string; value: string; shown?: string; hint?: string; accent?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => undefined);
  }
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>
        <strong className={accent ? styles.accent : undefined}>{shown ?? value}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" className={styles.copy} onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? "Đã copy" : "Copy"}</button>
    </div>
  );
}

/** Ảnh QR: dựng từ chuỗi VietQR của đơn (đã điền số tiền, mã đơn) ngay trên máy; không có thì dùng ảnh QR tĩnh. */
function QrImage({ payload, fallback, alt }: { payload: string | null; fallback: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(payload ? null : fallback);
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    QRCode.toDataURL(payload, { margin: 1, width: 560, errorCorrectionLevel: "M" }).then((url) => alive && setSrc(url), () => alive && setSrc(fallback));
    return () => { alive = false; };
  }, [payload, fallback]);
  if (!src) return <div className={styles.qrPlaceholder} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.qr} src={src} alt={alt} />;
}

function Countdown({ expiresAt, clockOffsetMs, onDone }: { expiresAt: string; clockOffsetMs: number; onDone: () => void }) {
  const remaining = useCallback(() => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now() - clockOffsetMs) / 1000)), [expiresAt, clockOffsetMs]);
  const [left, setLeft] = useState<number | null>(null);
  // Hết giờ chỉ hỏi máy chủ một lần; lượt hỏi định kỳ lo phần còn lại.
  const notified = useRef(false);
  useEffect(() => {
    const tick = () => {
      const value = remaining();
      setLeft(value);
      if (value === 0 && !notified.current) {
        notified.current = true;
        onDone();
      }
    };
    const timer = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [remaining, onDone]);
  if (left === null) return null;
  return <strong className={styles.clock}>{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</strong>;
}

function Pending({ order, clockOffsetMs, onExpire }: { order: Order; clockOffsetMs: number; onExpire: () => void }) {
  const payment = order.payment!;
  const filled = !!payment.qrPayload;
  return (
    <>
      <h1 className={ui.h2}>Thanh toán đơn {order.code}</h1>
      <p className={ui.muted}>{order.courseTitleVi} · Bước 2 / 3: Thông tin → Thanh toán → Vào học</p>
      <p className={ui.notice}>Đơn hết hạn sau <Countdown expiresAt={order.expiresAt} clockOffsetMs={clockOffsetMs} onDone={onExpire} /></p>
      <section className={styles.pay} aria-label="Chuyển khoản">
        <p className={styles.payTitle}>Dùng app ngân hàng quét mã QR</p>
        <div className={styles.qrFrame}>
          <div className={styles.qrBox}>
            {/* key: đổi chuỗi QR hoặc ảnh tĩnh thì dựng lại từ đầu, không bao giờ còn hiện QR cũ. */}
            <QrImage key={`${payment.qrPayload ?? ""}|${payment.qrImageUrl ?? ""}`} payload={payment.qrPayload} fallback={payment.qrImageUrl} alt={`Mã QR chuyển khoản ${formatVnd(order.amountDueVnd)} tới ${payment.accountName}, nội dung ${order.code}`} />
            <p className={styles.qrCaption}>
              <strong>{payment.accountName}</strong>
              <span>{payment.accountNo}</span>
              {filled && <span>Số tiền: {formatVnd(order.amountDueVnd)}</span>}
            </p>
          </div>
          <p className={styles.qrNote}>{filled ? "Mã QR đã có sẵn số tiền và nội dung" : "Nhập đúng số tiền và nội dung là mã đơn"}</p>
        </div>
        <p className={styles.amountLabel}>Số tiền thanh toán</p>
        <p className={styles.amount}>{formatVnd(order.amountDueVnd)}</p>
        <div className={styles.table}>
          <CopyRow label="Ngân hàng" value={payment.bankName} />
          <CopyRow label="Số tài khoản" value={payment.accountNo} />
          <CopyRow label="Chủ tài khoản" value={payment.accountName} />
          <CopyRow label="Nội dung" value={order.code} accent />
        </div>
      </section>
      <p className={styles.after}>
        Ghi đúng nội dung <strong>{order.code}</strong>.{" "}
        {payment.autoConfirm
          ? "Giữ trang này: khóa học tự mở khi hệ thống nhận được tiền."
          : "Chuyển khoản xong, khóa học mở khi tiền được xác nhận (trong giờ làm việc). Trang này tự cập nhật, hoặc xem lại ở Lịch sử thanh toán."}
      </p>
    </>
  );
}

export function Checkout({ code }: { code: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "offline" | "server">("loading");
  // Đếm ngược theo giờ máy chủ: đồng hồ điện thoại trên tàu có thể lệch.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const router = useRouter();
  // Nhiều lượt hỏi có thể chạy cùng lúc (định kỳ, mở lại tab, hết giờ): chỉ nhận kết quả mới nhất, và không bao giờ lùi từ trạng thái kết thúc.
  const generation = useRef(0);
  const settled = useRef(false);

  const load = useCallback(async () => {
    if (settled.current) return;
    const id = ++generation.current;
    const res = await fetch(`/api/me/orders/${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => null);
    if (id !== generation.current || settled.current) return;
    if (res?.status === 401) {
      router.replace(`/dang-nhap?next=${encodeURIComponent(`/thanh-toan/${code}`)}`);
      return;
    }
    if (res?.status === 404) return setState("missing");
    // Mất mạng hay máy chủ lỗi thì giữ màn đang có: thông tin chuyển khoản vẫn đọc được, chỉ báo thêm.
    if (!res) return setState("offline");
    if (!res.ok) return setState("server");
    const next = (await res.json()) as Order;
    if (id !== generation.current || settled.current) return;
    if (next.status === "paid" || next.status === "refunded") settled.current = true;
    setClockOffsetMs(new Date(next.serverNow).getTime() - Date.now());
    setOrder(next);
    setState("ready");
  }, [code, router]);

  const finished = order?.status === "paid" || order?.status === "refunded";
  const openOrder = Boolean(order?.payment);

  useEffect(() => {
    if (finished) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = (ms: number) => { timer = setTimeout(run, ms); };
    async function run() {
      if (document.visibilityState === "visible") await load();
      if (!stopped) schedule(openOrder ? POLL_OPEN_MS : POLL_EXPIRED_MS);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule(state === "loading" ? 0 : openOrder ? POLL_OPEN_MS : POLL_EXPIRED_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // state chỉ quyết định lần hỏi đầu; không chạy lại mỗi lần đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, openOrder, load]);

  if (state === "loading") return <p className={ui.muted}>Đang tải đơn…</p>;
  if (state === "missing") return <p className={ui.error} role="alert">Không tìm thấy đơn này. <Link href="/khoa-hoc">Xem các khóa</Link></p>;
  if (!order) return <p className={ui.error} role="alert">Chưa tải được đơn. Kiểm tra mạng, trang sẽ tự thử lại.</p>;

  return (
    <>
      {state === "offline" && <p className={ui.notice} role="status">Đang mất kết nối, trang sẽ tự thử lại.</p>}
      {state === "server" && <p className={ui.notice} role="status">Máy chủ đang gặp lỗi, trang sẽ tự thử lại.</p>}
      {order.needsManual && !finished && (
        <p className={ui.notice} role="status">Hệ thống đã ghi nhận một khoản chuyển cho đơn này nhưng cần đối chiếu tay. Đừng chuyển lại.</p>
      )}
      {order.status === "paid" && (
        <div className={ui.card} role="status">
          <h1 className={ui.h2}>Thanh toán thành công</h1>
          <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}.</p>
          {order.enrolled && <Link className={ui.action} href={`/hoc?khoa=${order.courseSlug}`}>Vào học ngay</Link>}
        </div>
      )}
      {order.status === "refunded" && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Đơn đã hoàn tiền</h1>
          <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}.</p>
          <Link className={ui.outline} href={`/khoa-hoc/${order.courseSlug}`}>Xem khóa học</Link>
        </div>
      )}
      {!finished && order.payment && <Pending order={order} clockOffsetMs={clockOffsetMs} onExpire={() => void load()} />}
      {!finished && order.paymentUnavailable && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Tạm ngừng nhận thanh toán</h1>
          <p className={ui.notice}>Chưa chuyển tiền thì đừng chuyển lúc này. Đã chuyển rồi thì đừng chuyển lại: trang này vẫn theo dõi đơn {order.code}.</p>
        </div>
      )}
      {!finished && !order.payment && !order.paymentUnavailable && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Đơn đã hết hạn</h1>
          <p className={ui.notice}>Đã chuyển tiền rồi? Đừng chuyển lại. Trang này vẫn theo dõi đơn; khoản chuyển sẽ được đối chiếu và mở khóa.</p>
          <Link className={ui.action} href={`/mua/${order.courseSlug}`}>Tạo đơn mới</Link>
        </div>
      )}
    </>
  );
}
