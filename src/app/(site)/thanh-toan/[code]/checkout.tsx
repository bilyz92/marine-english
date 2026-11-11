"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BuySteps } from "@/components/buy-steps";
import ui from "@/components/ui.module.css";
import { learnerCsrfHeader } from "@/lib/client/api";
import { formatVnd } from "@/lib/format";
import { TransferProof } from "@/components/transfer-proof";
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
  /** Khoản chuyển của chính đơn này đang chờ đối chiếu tay; lý do null khi giao dịch chưa xác minh. */
  manualTransfers: { amountVnd: number; reason: string | null }[];
  paymentUnavailable: boolean;
  payment: { bankName: string; accountNo: string; accountName: string; qrImageUrl: string | null; qrPayload: string | null; autoConfirm: boolean } | null;
  claim: { status: "none" | "open" | "approved" | "rejected"; rejectionReason: string | null; proofs: number };
  /** Đơn hết hạn nhưng tạo chưa quá 24 giờ, chưa có SePay: vẫn bấm "Tôi đã chuyển khoản" được. */
  claimable: boolean;
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
function QrImage({ payload, fallback, alt, fileName }: { payload: string | null; fallback: string | null; alt: string; fileName: string }) {
  const [src, setSrc] = useState<string | null>(payload ? null : fallback);
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    QRCode.toDataURL(payload, { margin: 1, width: 560, errorCorrectionLevel: "M" }).then((url) => alive && setSrc(url), () => alive && setSrc(fallback));
    return () => { alive = false; };
  }, [payload, fallback]);
  if (!src) return <div className={styles.qrPlaceholder} aria-hidden="true" />;
  // Trả bằng chính điện thoại đang hiện mã thì không tự quét được: lưu ảnh rồi chọn ảnh trong app ngân hàng (giao diện v2).
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.qr} src={src} alt={alt} />
      <a className={styles.save} href={src} download={fileName}>Lưu ảnh QR</a>
    </>
  );
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

const CLAIM_ERRORS: Record<string, string> = {
  claim_limit: "Bạn đang có một khóa chờ xác nhận tiền. Khi khóa đó được xác nhận thì mở tạm được khóa này.",
  too_late: "Đơn đã tạo quá 24 giờ. Nếu đã chuyển tiền, liên hệ chủ khóa học kèm ảnh chuyển khoản.",
  claim_rejected: "Đơn này đã bị khóa lại. Gửi ảnh chứng minh để chủ khóa học kiểm tra.",
};

/** Chưa có SePay (chủ quyết định 03/11/2026): khách bấm báo đã chuyển là học được ngay, chủ đối soát sau. */
function ClaimButton({ code, onDone }: { code: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function claim() {
    setBusy(true);
    setProblem(null);
    const res = await fetch(`/api/me/orders/${encodeURIComponent(code)}/claim`, { method: "POST", headers: learnerCsrfHeader() }).catch(() => null);
    setBusy(false);
    if (!res) return setProblem("Mất kết nối. Thử lại khi có mạng.");
    if (!res.ok) {
      const error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "";
      if (error === "already_paid" || error === "already_enrolled") return onDone();
      return setProblem(CLAIM_ERRORS[error] ?? "Chưa ghi nhận được. Thử lại sau.");
    }
    onDone();
  }
  return (
    <div className={styles.claim}>
      <button type="button" className={ui.action} disabled={busy} onClick={() => void claim()}>{busy ? "Đang mở khóa…" : "Tôi đã chuyển khoản"}</button>
      <p className={ui.muted}>Bấm sau khi chuyển xong: khóa học mở ngay để bạn học. Chủ khóa học đối chiếu sao kê sau; không thấy tiền thì khóa học bị khóa lại.</p>
      {problem && <p className={ui.error} role="alert">{problem}</p>}
    </div>
  );
}

/**
 * Bước 3 (chủ 09/11/2026): khách tạo tài khoản ngay trên trang mua thấy số điện thoại và mật khẩu tạm ở đây (bước 1 không hiện).
 * Máy chủ chỉ trả khi đơn đã báo chuyển khoản hoặc đã thanh toán; tài khoản tự đặt mật khẩu thì không có gì để hiện.
 */
function AccountInfo({ code, paid }: { code: string; paid: boolean }) {
  const [info, setInfo] = useState<{ phone: string; password: string; email: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch(`/api/me/credentials?order=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { available: boolean; phone?: string; password?: string; email?: string | null }) : null))
      .then((r) => { if (live && r?.available) setInfo({ phone: r.phone!, password: r.password!, email: r.email ?? null }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [code]);
  if (!info) return null;
  return (
    <section className={styles.account} aria-label="Tài khoản của bạn">
      <h2 className={ui.h3}>Tài khoản của bạn</h2>
      <dl className={styles.accountList}>
        <div><dt>Số điện thoại</dt><dd>{info.phone}</dd></div>
        <div><dt>Mật khẩu tạm</dt><dd className={styles.accountPassword}>{info.password}</dd></div>
        {info.email && <div><dt>Email nhận thư</dt><dd>{info.email}</dd></div>}
      </dl>
      <button type="button" className={ui.outline} onClick={() => void navigator.clipboard?.writeText(info.password).then(() => setCopied(true), () => undefined)}>
        {copied ? "Đã sao chép" : "Sao chép mật khẩu"}
      </button>
      <p className={ui.muted}>Ghi lại để đăng nhập trên máy khác. Lần đầu đăng nhập bằng mật khẩu tạm, bạn sẽ đặt mật khẩu mới.</p>
      {!paid && <p className={ui.muted}>Thông tin này cũng được gửi vào email của bạn khi thanh toán xong.</p>}
    </section>
  );
}

/** Tiền đã về nhưng chưa tự mở khóa được: nói rõ đã nhận bao nhiêu, đơn cần bao nhiêu, và đừng chuyển lại. */
function ManualState({ order }: { order: Order }) {
  const received = order.manualTransfers.reduce((sum, t) => sum + t.amountVnd, 0);
  const one = order.manualTransfers.length === 1 ? order.manualTransfers[0]!.reason : null;
  const due = order.amountDueVnd;
  const detail =
    one === "amount_short" ? `Còn thiếu ${formatVnd(due - received)}. Chủ khóa học sẽ liên hệ để xử lý phần thiếu; đừng chuyển thêm khi chưa được hướng dẫn.`
    : one === "amount_over" ? `Thừa ${formatVnd(received - due)}. Chủ khóa học sẽ đối chiếu, mở khóa và liên hệ về phần thừa.`
    : one === "late" ? "Tiền về sau khi đơn hết hạn. Chủ khóa học sẽ đối chiếu và mở khóa."
    : "Chủ khóa học sẽ đối chiếu và mở khóa.";
  return (
    <div className={ui.card} role="status">
      <h2 className={ui.h3}>Đã nhận tiền, đang đối chiếu</h2>
      {received > 0 && <p className={ui.lead}>Đã nhận {formatVnd(received)}, đơn {order.code} cần {formatVnd(due)}.</p>}
      <p className={ui.notice}>{received > 0 ? detail : "Hệ thống đã ghi nhận một khoản chuyển cho đơn này nhưng cần đối chiếu tay."} Đừng chuyển lại cả đơn.</p>
    </div>
  );
}

function ClaimState({ order, onChanged }: { order: Order; onChanged: () => void }) {
  if (order.claim.status === "open") {
    return (
      <>
      <BuySteps current={3} />
      <div className={ui.card} role="status">
        <h1 className={ui.h2}>Khóa học đã mở</h1>
        <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}. Bạn đã báo chuyển khoản {formatVnd(order.amountDueVnd)}; chủ khóa học sẽ đối chiếu sao kê.</p>
        {order.enrolled && <Link className={ui.action} href={`/hoc?khoa=${order.courseSlug}`}>Vào học ngay</Link>}
        <AccountInfo code={order.code} paid={false} />
      </div>
      </>
    );
  }
  return (
    <div className={ui.card} role="alert">
      <h1 className={ui.h2}>Khóa học tạm khóa</h1>
      <p className={ui.notice}>
        Tiền chưa được xác nhận{order.claim.rejectionReason ? `: ${order.claim.rejectionReason}` : "."}
      </p>
      <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}, {formatVnd(order.amountDueVnd)}. Nếu đã chuyển tiền, gửi ảnh chụp giao dịch để chủ khóa học kiểm tra lại.</p>
      {order.claim.proofs > 0 && <p className={ui.muted}>Đã gửi {order.claim.proofs} ảnh. Chủ khóa học sẽ xem và mở lại khi thấy tiền.</p>}
      <TransferProof code={order.code} onSent={onChanged} />
    </div>
  );
}

function Pending({ order, clockOffsetMs, onExpire }: { order: Order; clockOffsetMs: number; onExpire: () => void }) {
  const payment = order.payment!;
  const filled = !!payment.qrPayload;
  return (
    <>
      <BuySteps current={2} />
      <h1 className={ui.h2}>Thanh toán đơn {order.code}</h1>
      <p className={ui.muted}>{order.courseTitleVi}</p>
      <p className={ui.notice}>Đơn hết hạn sau <Countdown expiresAt={order.expiresAt} clockOffsetMs={clockOffsetMs} onDone={onExpire} /></p>
      <section className={styles.pay} aria-label="Chuyển khoản">
        <p className={styles.payTitle}>Dùng app ngân hàng quét mã QR</p>
        <div className={styles.qrFrame}>
          <div className={styles.qrBox}>
            {/* key: đổi chuỗi QR hoặc ảnh tĩnh thì dựng lại từ đầu, không bao giờ còn hiện QR cũ. */}
            <QrImage key={`${payment.qrPayload ?? ""}|${payment.qrImageUrl ?? ""}`} payload={payment.qrPayload} fallback={payment.qrImageUrl} alt={`Mã QR chuyển khoản ${formatVnd(order.amountDueVnd)} tới ${payment.accountName}, nội dung ${order.code}`} fileName={`QR-${order.code}.png`} />
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
          : "Chuyển khoản xong, bấm nút bên dưới để vào học ngay."}
      </p>
      {order.claimable && <ClaimButton code={order.code} onDone={onExpire} />}
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
      {order.needsManual && !finished && <ManualState order={order} />}
      {order.status === "paid" && <BuySteps current={3} />}
      {order.status === "paid" && (
        <div className={ui.card} role="status">
          <h1 className={ui.h2}>Thanh toán thành công</h1>
          <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}.</p>
          {order.enrolled && <Link className={ui.action} href={`/hoc?khoa=${order.courseSlug}`}>Vào học ngay</Link>}
          <AccountInfo code={order.code} paid />
        </div>
      )}
      {order.status === "refunded" && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Đơn đã hoàn tiền</h1>
          <p className={ui.lead}>Đơn {order.code}: {order.courseTitleVi}.</p>
          <Link className={ui.outline} href={`/khoa-hoc/${order.courseSlug}`}>Xem khóa học</Link>
        </div>
      )}
      {!finished && (order.claim.status === "open" || order.claim.status === "rejected") && <ClaimState order={order} onChanged={() => void load()} />}
      {/* Tiền của đơn đã về, chờ đối chiếu: ẩn QR để không ai chuyển thêm cả đơn lần nữa. */}
      {!finished && order.claim.status === "none" && order.payment && order.manualTransfers.length === 0 && <Pending order={order} clockOffsetMs={clockOffsetMs} onExpire={() => void load()} />}
      {!finished && order.paymentUnavailable && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Tạm ngừng nhận thanh toán</h1>
          <p className={ui.notice}>Chưa chuyển tiền thì đừng chuyển lúc này. Đã chuyển rồi thì đừng chuyển lại: trang này vẫn theo dõi đơn {order.code}.</p>
        </div>
      )}
      {!finished && order.claim.status === "none" && !order.payment && !order.paymentUnavailable && (
        <div className={ui.card}>
          <h1 className={ui.h2}>Đơn đã hết hạn</h1>
          <p className={ui.notice}>Đã chuyển tiền rồi? Đừng chuyển lại. Trang này vẫn theo dõi đơn; khoản chuyển sẽ được đối chiếu và mở khóa.</p>
          {order.claimable && <ClaimButton code={order.code} onDone={() => void load()} />}
          <Link className={ui.outline} href={`/mua/${order.courseSlug}`}>Tạo đơn mới</Link>
        </div>
      )}
    </>
  );
}
