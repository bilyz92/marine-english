"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { INSTALL_PARAM, browserKind, openInChromeUrl, openInSafariUrl, type BrowserKind } from "@/lib/install-links";
import styles from "./install-app.module.css";

/** Sự kiện Chrome/Edge gửi khi trang cài được thành app (chưa có trong thư viện kiểu của TypeScript). */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const subscribeDisplayMode = (onChange: () => void) => {
  const query = matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
// Đang mở dạng app (đã cài) thì không cần nút. iPhone báo qua navigator.standalone.
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const noop = () => () => {};
const kindNow = (): BrowserKind => browserKind(navigator.userAgent, navigator.maxTouchPoints);

/** Hình nút Chia sẻ của Safari (ô vuông có mũi tên lên) và mục “Thêm vào MH chính” (ô vuông có dấu cộng). */
function ShareIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
function AddIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/**
 * Nút “Tải app về điện thoại”: app học là web app (PWA) mở thẳng vào /hoc, học được khi không có mạng với bài đã tải.
 * Android (Chrome/Edge): hộp thoại cài sẵn của trình duyệt. Trong Zalo/Facebook: nút chuyển sang Chrome (Android) hay Safari (iPhone),
 * trang mở ra với ?cai=1 tự hiện hướng dẫn. iPhone: Apple không cho trang tự cài, nên hướng dẫn có hình nút Chia sẻ (chủ 18/11/2026).
 */
export function InstallApp({ className, label = "Tải app về điện thoại" }: { className?: string; label?: string }) {
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const kind = useSyncExternalStore(noop, kindNow, () => "other" as BrowserKind);
  // Trên điện thoại nút nằm trong menu đang đóng (display: none): hộp hướng dẫn gắn thẳng vào <body> để luôn hiện được.
  const body = useSyncExternalStore(noop, () => document.body as HTMLElement | null, () => null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoOpen = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", onInstalled);
    // Cùng service worker của app học (chỉ lưu /hoc và tệp tĩnh), để trình duyệt nhận trang này cài được.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    // Vừa được chuyển sang Chrome/Safari từ Zalo/Facebook: tự mở hướng dẫn, rồi bỏ dấu ?cai=1 khỏi địa chỉ.
    const url = new URL(location.href);
    if (url.searchParams.get(INSTALL_PARAM) === "1" && !isStandalone()) {
      url.searchParams.delete(INSTALL_PARAM);
      history.replaceState(history.state, "", url);
      autoOpen.current = true;
    }
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Hộp chỉ có sau khi gắn vào <body>, nên mở tự động ở nhịp sau.
  useEffect(() => {
    if (autoOpen.current && body && dialog.current && !dialog.current.open) {
      autoOpen.current = false;
      dialog.current.showModal();
    }
  }, [body]);

  if (standalone || installed) return null;

  const canPrompt = prompt !== null && (kind === "android" || kind === "other");

  async function runPrompt() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") { setInstalled(true); dialog.current?.close(); }
  }

  async function install() {
    if (canPrompt) return runPrompt();
    dialog.current?.showModal();
  }

  async function copyLink() {
    const url = new URL(location.href);
    url.hash = "";
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      window.prompt("Chép link này rồi dán vào Safari:", url.toString());
    }
  }

  const iosSteps = (where: string) => (
    <ol className={styles.steps}>
      <li>
        Bấm nút <b>Chia sẻ</b> <ShareIcon /> {where}.
        <span className={styles.hint}> iOS 26: bấm nút <b>⋯</b> ở góc dưới bên phải rồi chọn <b>Chia sẻ</b>.</span>
      </li>
      <li>Kéo xuống, chọn <b>Thêm vào MH chính</b> <AddIcon />.</li>
      <li>Bấm <b>Thêm</b>. Biểu tượng Marine English hiện trên màn hình chính.</li>
    </ol>
  );

  return (
    <>
      <button type="button" className={className} onClick={() => void install()}>{label}</button>
      {body && createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="install-title" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <h2 id="install-title" className={styles.title}>Cài app Marine English</h2>
        <p className={styles.lead}>App mở thẳng vào phần học. Bài đã tải học được cả khi trên tàu không có mạng.</p>

        {kind === "android-in-app" && (
          <section>
            <p className={styles.warn}>Zalo và Facebook không cài được app. Bấm nút dưới để mở trang này bằng Chrome, rồi bấm “Cài đặt”.</p>
            <a className={styles.action} href={openInChromeUrl(location.href)}>Mở bằng Chrome để cài</a>
          </section>
        )}
        {kind === "ios-in-app" && (
          <section>
            <p className={styles.warn}>Zalo và Facebook không cài được app. Bấm nút dưới để mở trang này bằng Safari, rồi làm theo hướng dẫn hiện ra.</p>
            <a className={styles.action} href={openInSafariUrl(location.href)}>Mở bằng Safari để cài</a>
            <p className={styles.lead}>Không chuyển được sang Safari? Chép link rồi dán vào Safari:</p>
            <button type="button" className={styles.secondary} onClick={() => void copyLink()}>{copied ? "Đã chép link" : "Chép link"}</button>
          </section>
        )}
        {kind === "ios-safari" && (
          <section>
            <h3 className={styles.subtitle}>iPhone (Safari)</h3>
            {iosSteps("ở thanh dưới cùng màn hình")}
            <p className={styles.pointer} aria-hidden="true">↓</p>
          </section>
        )}
        {kind === "ios-other" && (
          <section>
            <h3 className={styles.subtitle}>iPhone (Chrome)</h3>
            {iosSteps("cạnh ô địa chỉ")}
          </section>
        )}
        {(kind === "android" || kind === "other") && (
          <section>
            {canPrompt && <button type="button" className={styles.action} onClick={() => void runPrompt()}>Cài đặt ngay</button>}
            <h3 className={styles.subtitle}>Android (Chrome)</h3>
            <ol className={styles.steps}>
              <li>Bấm nút ⋮ ở góc trên bên phải.</li>
              <li>Chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.</li>
              <li>Bấm “Cài đặt”. Biểu tượng Marine English hiện trên màn hình chính.</li>
            </ol>
          </section>
        )}
        {kind === "other" && (
          <section>
            <h3 className={styles.subtitle}>iPhone (Safari)</h3>
            {iosSteps("ở thanh dưới cùng màn hình")}
            <p className={styles.lead}>Đang dùng máy tính? Mở trang này trên điện thoại rồi làm theo các bước trên.</p>
          </section>
        )}
        <form method="dialog"><button className={styles.close}>Đã hiểu</button></form>
      </dialog>, body)}
    </>
  );
}
