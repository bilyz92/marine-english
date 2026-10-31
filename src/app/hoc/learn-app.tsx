"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  loadIdentity, licenseStatus, pendingCount, syncNow,
  type Identity, type LicenseStatus,
} from "@/lib/offline/engine";
import { CourseList } from "./course-list";
import { CourseView } from "./course-view";
import { LessonView } from "./lesson-view";
import styles from "./learn.module.css";

/** Đổi màn bằng history (không gọi máy chủ), nên vẫn chuyển được khi mất mạng. */
export function go(params: { khoa?: string; bai?: number }) {
  const query = new URLSearchParams();
  if (params.khoa) query.set("khoa", params.khoa);
  if (params.bai) query.set("bai", String(params.bai));
  const text = query.toString();
  window.history.pushState(null, "", text ? `/hoc?${text}` : "/hoc");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").then(async () => {
    const ready = await navigator.serviceWorker.ready;
    const urls = [location.pathname, ...performance.getEntriesByType("resource").map((e) => e.name)];
    ready.active?.postMessage({ type: "cache-urls", urls });
  }, () => undefined);
}

type Load = { kind: "loading" } | { kind: "login" } | { kind: "ready"; identity: Identity };

export function LearnApp() {
  const params = useSearchParams();
  const slug = params.get("khoa");
  const position = Number(params.get("bai") ?? 0);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [pending, setPending] = useState(0);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async (identity: Identity) => {
    const result = await syncNow(identity);
    setOffline(!result.ok && result.reason === "offline");
    if (!result.ok && result.reason === "unauthorized") setLoad({ kind: "login" });
    setLicense(await licenseStatus(identity));
    setPending(await pendingCount(identity));
  }, []);

  useEffect(() => {
    registerServiceWorker();
    loadIdentity().then(({ identity, online }) => {
      setOffline(!online);
      if (!identity) return setLoad({ kind: "login" });
      setLoad({ kind: "ready", identity });
      void refresh(identity);
    });
  }, [refresh]);

  // Có mạng trở lại thì đồng bộ ngay.
  useEffect(() => {
    if (load.kind !== "ready") return;
    const identity = load.identity;
    const onOnline = () => void refresh(identity);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, refresh]);

  if (load.kind === "loading") return <main className={styles.page}><div className={styles.wrap}><p className={styles.muted}>Đang mở…</p></div></main>;
  if (load.kind === "login") {
    return (
      <main className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.card}>
            <h1 className={styles.h1}>Cần đăng nhập</h1>
            <p className={styles.muted}>Phiên đăng nhập đã hết. Kết nối mạng và đăng nhập lại để học tiếp.</p>
            <p><a className={styles.barLink} href="/dang-nhap">Đăng nhập</a></p>
          </div>
        </div>
      </main>
    );
  }

  const identity = load.identity;
  const onEvent = () => void pendingCount(identity).then(setPending);
  const syncAndCount = () => void refresh(identity);

  return (
    <main className={styles.page}>
      <div className={styles.bar}>
        <button className={styles.brand} onClick={() => go({})}>Marine English</button>
        <a className={styles.barLink} href="/tai-khoan">{identity.displayName}</a>
      </div>
      <div className={styles.wrap}>
        <StatusBanners license={license} offline={offline} pending={pending} />
        {!slug && <CourseList identity={identity} />}
        {slug && !position && <CourseView identity={identity} slug={slug} license={license} />}
        {slug && position > 0 && (
          <LessonView identity={identity} slug={slug} position={position} license={license} onEvent={onEvent} onFinish={syncAndCount} />
        )}
      </div>
    </main>
  );
}

function StatusBanners({ license, offline, pending }: { license: LicenseStatus | null; offline: boolean; pending: number }) {
  return (
    <>
      {offline && (
        <div className={styles.banner}>
          Đang không có mạng. Bài đã tải vẫn học được{pending > 0 ? `; ${pending} hoạt động sẽ đồng bộ khi có mạng` : ""}.
        </div>
      )}
      {license?.state === "grace" && (
        <div className={styles.banner}>Giấy phép học offline đã hết hạn. Kết nối mạng sớm để học tiếp sau thời gian ân hạn.</div>
      )}
      {license?.state === "locked" && (
        <div className={styles.bannerDanger}>Đã quá hạn học offline. Bài trả phí bị khóa cho tới khi máy kết nối mạng và đồng bộ. Bài học thử vẫn mở.</div>
      )}
      {license?.state === "ok" && license.daysLeft !== null && license.daysLeft <= 7 && (
        <div className={styles.banner}>Giấy phép học offline còn {license.daysLeft} ngày. Kết nối mạng để gia hạn.</div>
      )}
    </>
  );
}
