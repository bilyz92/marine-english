"use client";

import { useCallback, useEffect, useState } from "react";
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
  payment: { bankName: string; accountNo: string; accountName: string; qrImageUrl: string } | null;
};

const POLL_OPEN_MS = 5_000;
// Đơn đã hết hạn vẫn hỏi tiếp, thưa hơn: tiền chuyển trong hạn có thể báo về muộn và đơn vẫn thành đã thanh toán.
const POLL_EXPIRED_MS = 30_000;

function CopyRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => undefined);
  }
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={ui.muted}>{label}</span>
        <strong className={styles.value}>{shown ?? value}</strong>
      </div>
      <button type="button" className={ui.outline} onClick={() => void copy()} aria-label={`Chép ${label}`}>{copied ? "Đã chép" : "Chép"}</button>
    </div>
  );
}

function Countdown({ expiresAt, clockOffsetMs, onDone }: { expiresAt: string; clockOffsetMs: number; onDone: () => void }) {
  const remaining = useCallback(() => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now() - clockOffsetMs) / 1000)), [expiresAt, clockOffsetMs]);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const value = remaining();
      setLeft(value);
      if (value === 0) onDone();
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
  return (
    <>
      <h1 className={ui.h2}>Quét mã để thanh toán</h1>
      <p className={ui.muted}>Bước 2 / 3: Thông tin → Thanh toán → Vào học</p>
      <p className={ui.notice}>Đơn hết hạn sau <Countdown expiresAt={order.expiresAt} clockOffsetMs={clockOffsetMs} onDone={onExpire} /></p>
      <div className={ui.card}>
        <ol className={styles.steps}>
          <li>Quét mã QR bằng app ngân hàng, hoặc chuyển khoản theo thông tin dưới đây.</li>
          <li>Nhập đúng số tiền và nội dung là mã đơn.</li>
          <li>Giữ trang này: khóa học tự mở khi hệ thống nhận được tiền.</li>
        </ol>
        {/* Ảnh QR tĩnh của tài khoản nhận tiền, không chứa số tiền hay nội dung. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.qr} src={payment.qrImageUrl} alt={`Mã QR tài khoản ${payment.accountName}`} />
        <a className={ui.outline} href={payment.qrImageUrl} download>Lưu ảnh QR</a>
      </div>
      <div className={ui.card}>
        <h2 className={ui.h3}>Thông tin chuyển khoản</h2>
        <CopyRow label="Nội dung chuyển khoản" value={order.code} />
        <CopyRow label="Số tiền" value={String(order.amountDueVnd)} shown={formatVnd(order.amountDueVnd)} />
        <CopyRow label="Số tài khoản" value={payment.accountNo} />
        <div className={styles.row}><div className={styles.rowText}><span className={ui.muted}>Ngân hàng</span><strong>{payment.bankName}</strong></div></div>
        <div className={styles.row}><div className={styles.rowText}><span className={ui.muted}>Chủ tài khoản</span><strong>{payment.accountName}</strong></div></div>
        <p className={ui.lead}>Ghi đúng nội dung <strong>{order.code}</strong> để khóa học tự mở.</p>
      </div>
      <p className={ui.muted}>{order.courseTitleVi}</p>
    </>
  );
}

export function Checkout({ code }: { code: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "offline">("loading");
  // Đếm ngược theo giờ máy chủ: đồng hồ điện thoại trên tàu có thể lệch.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const router = useRouter();

  const load = useCallback(async () => {
    const res = await fetch(`/api/me/orders/${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) {
      router.replace(`/dang-nhap?next=${encodeURIComponent(`/thanh-toan/${code}`)}`);
      return;
    }
    if (res?.status === 404) return setState("missing");
    // Mất mạng thì giữ màn đang có: thông tin chuyển khoản vẫn đọc được, chỉ báo thêm.
    if (!res?.ok) return setState("offline");
    const next = (await res.json()) as Order;
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
      {!finished && !order.payment && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Đơn đã hết hạn</h1>
          <p className={ui.notice}>Đã chuyển tiền rồi? Đừng chuyển lại. Trang này vẫn theo dõi đơn; khoản chuyển sẽ được đối chiếu và mở khóa.</p>
          <Link className={ui.action} href={`/mua/${order.courseSlug}`}>Tạo đơn mới</Link>
        </div>
      )}
    </>
  );
}
