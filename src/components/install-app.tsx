"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./install-app.module.css";

/** Sự kiện Chrome/Edge gửi khi trang cài được thành app (chưa có trong thư viện kiểu của TypeScript). */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Platform = "ios" | "android" | "other";

const subscribeDisplayMode = (onChange: () => void) => {
  const query = matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
// Đang mở dạng app (đã cài) thì không cần nút. iPhone báo qua navigator.standalone.
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const noop = () => () => {};
const platformOf = (): Platform => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "other";
};
// Trình duyệt bên trong Zalo, Facebook, Messenger không cài được app: phải mở bằng Chrome/Safari trước.
const inAppBrowser = () => /Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram/i.test(navigator.userAgent);

/**
 * Nút “Tải app về điện thoại”: app học là web app (PWA) mở thẳng vào /hoc, học được khi không có mạng với bài đã tải.
 * Chrome/Edge trên Android có hộp thoại cài sẵn; iPhone (Safari) và trình duyệt trong Zalo/Facebook thì hiện hướng dẫn từng bước.
 */
export function InstallApp({ className, label = "Tải app về điện thoại" }: { className?: string; label?: string }) {
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const platform = useSyncExternalStore(noop, platformOf, () => "other" as Platform);
  const embedded = useSyncExternalStore(noop, inAppBrowser, () => false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
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
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed) return null;

  async function install() {
    // iPhone không có hộp thoại cài; trong Zalo/Facebook cũng không cài được: luôn hướng dẫn.
    if (prompt && !embedded && platform !== "ios") {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      if (outcome === "accepted") setInstalled(true);
      return;
    }
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void install()}>{label}</button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="install-title" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <h2 id="install-title" className={styles.title}>Cài app Marine English</h2>
        <p className={styles.lead}>App mở thẳng vào phần học. Bài đã tải học được cả khi trên tàu không có mạng.</p>
        {embedded && (
          <p className={styles.warn}>Đang mở trong Zalo hoặc Facebook: bấm nút ⋯ hoặc ⋮ rồi chọn “Mở bằng trình duyệt” (Safari trên iPhone, Chrome trên Android), sau đó làm theo các bước dưới.</p>
        )}
        {platform !== "android" && (
          <section>
            <h3 className={styles.subtitle}>iPhone (Safari)</h3>
            <ol className={styles.steps}>
              <li>Bấm nút Chia sẻ (hình vuông có mũi tên lên) ở cuối màn hình.</li>
              <li>Kéo xuống, chọn “Thêm vào MH chính”.</li>
              <li>Bấm “Thêm”. Biểu tượng Marine English hiện trên màn hình chính.</li>
            </ol>
          </section>
        )}
        {platform !== "ios" && (
          <section>
            <h3 className={styles.subtitle}>Android (Chrome)</h3>
            <ol className={styles.steps}>
              <li>Bấm nút ⋮ ở góc trên bên phải.</li>
              <li>Chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.</li>
              <li>Bấm “Cài đặt”. Biểu tượng Marine English hiện trên màn hình chính.</li>
            </ol>
          </section>
        )}
        {platform === "other" && <p className={styles.lead}>Đang dùng máy tính? Mở trang này trên điện thoại rồi làm theo các bước trên.</p>}
        <form method="dialog"><button className={styles.close}>Đã hiểu</button></form>
      </dialog>
    </>
  );
}
