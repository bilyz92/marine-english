"use client";

import { useEffect, useState } from "react";
import { clearLocal, licenseStatus, loadIdentity, signOut, type Identity, type LicenseStatus } from "@/lib/offline/engine";
import { learnerCsrfHeader } from "@/lib/client/api";
import { forgetDeviceKey } from "../(site)/dang-nhap/device-key";
import styles from "../hoc/learn.module.css";
import { MyOrders } from "./my-orders";
import { PasswordSection } from "./password-section";

type Device = { id: string; label: string; lastSeenAt: string | null; current: boolean };
type IdentityRow = { id: string; kind: string; valueCanonical: string };

const KIND_LABEL: Record<string, string> = { email: "Email", google: "Google", phone: "Số điện thoại" };

export function Account() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [logins, setLogins] = useState<IdentityRow[]>([]);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshDevices() {
    const res = await fetch("/api/me/devices");
    if (res.ok) setDevices(((await res.json()) as { devices: Device[] }).devices);
  }

  useEffect(() => {
    void loadIdentity().then(async ({ identity: who, online: isOnline }) => {
      setIdentity(who);
      setLoaded(true);
      setOnline(isOnline);
      if (!who) return;
      setLicense(await licenseStatus(who));
      if (!isOnline) return;
      void refreshDevices();
      const res = await fetch("/api/me/identities");
      if (res.ok) setLogins(((await res.json()) as { identities: IdentityRow[] }).identities);
    });
  }, []);

  async function removeDevice(device: Device) {
    const res = await fetch(`/api/me/devices?id=${device.id}`, { method: "DELETE", headers: learnerCsrfHeader() });
    if (res.status === 403) return setMessage("Vì an toàn, cần đăng nhập lại trong 10 phút gần đây mới gỡ được thiết bị.");
    if (!res.ok) return setMessage("Không gỡ được thiết bị, thử lại sau.");
    if (device.current) {
      await clearLocal(identity);
      // Tải lại toàn trang: app học dựng lại dữ liệu offline theo người dùng mới.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      return window.location.assign("/dang-nhap");
    }
    setMessage(null);
    await refreshDevices();
  }

  async function logout(switchAccount: boolean) {
    if (!identity) return;
    await signOut(identity, { switchAccount });
    if (switchAccount) await forgetDeviceKey();
    // Tải lại toàn trang: app học dựng lại dữ liệu offline theo người dùng mới.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dang-nhap");
  }

  if (!loaded) return <main className={styles.page}><div className={styles.wrap}><p className={styles.muted}>Đang tải…</p></div></main>;
  if (!identity) {
    return (
      <main className={styles.page}><div className={styles.wrap}><div className={styles.card}>
        <p className={styles.muted}>Chưa đăng nhập.</p>
        <p><a className={styles.barLink} href="/dang-nhap">Đăng nhập</a></p>
      </div></div></main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.h1}>Tài khoản của tôi</h1>
          <p className={styles.muted}>{identity.displayName}</p>
          {license?.daysLeft !== null && license?.daysLeft !== undefined && (
            <p className={styles.muted}>Học offline còn {Math.max(license.daysLeft, 0)} ngày, tự gia hạn mỗi lần đồng bộ.</p>
          )}
        </div>
        {!online && <div className={styles.banner}>Đang không có mạng. Thiết bị và cách đăng nhập sẽ hiện khi có mạng.</div>}
        {message && <div className={styles.bannerDanger}>{message}</div>}
        {online && <MyOrders />}
        {logins.length > 0 && (
          <div className={styles.card}>
            <h2 className={styles.h2}>Cách đăng nhập</h2>
            {logins.map((l) => (
              <div key={l.id} className={styles.item}>
                <p className={styles.en}>{KIND_LABEL[l.kind] ?? l.kind}</p>
                {l.kind !== "google" && <p className={styles.vi}>{l.valueCanonical}</p>}
              </div>
            ))}
          </div>
        )}
        {online && <PasswordSection />}
        <div className={styles.card}>
          <h2 className={styles.h2}>Thiết bị của tôi (tối đa 2)</h2>
          {devices.map((d) => (
            <div key={d.id} className={styles.row}>
              <span className={styles.rowTitle}>
                {d.label}{d.current ? " (máy này)" : ""}
                <br />
                <span className={styles.vi}>{d.lastSeenAt ? `Dùng lần cuối ${new Date(d.lastSeenAt).toLocaleString("vi-VN")}` : "Chưa dùng"}</span>
              </span>
              <button className={styles.secondary} onClick={() => void removeDevice(d)}>Gỡ</button>
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button className={styles.secondary} disabled={!online} onClick={() => void logout(false)}>Đăng xuất</button>
          <button className={styles.secondary} disabled={!online} onClick={() => void logout(true)}>Đổi sang tài khoản khác</button>
        </div>
        <p className={styles.muted}>Đăng xuất sẽ xóa bài đã tải trên máy này; khi đăng nhập lại cần tải lại khi có mạng.</p>
      </div>
    </main>
  );
}
