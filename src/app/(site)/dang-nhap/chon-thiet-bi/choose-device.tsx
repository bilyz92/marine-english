"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../login.module.css";
import { DEVICES_KEY, postJson, type Device, NEXT_KEY } from "../api";
import { getDeviceKey } from "../device-key";

function loadDevices(): Device[] {
  try {
    return JSON.parse(sessionStorage.getItem(DEVICES_KEY) ?? "[]") as Device[];
  } catch {
    return [];
  }
}

export function ChooseDevice() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>(() => (typeof window === "undefined" ? [] : loadDevices()));

  // Sau đăng nhập Google không có danh sách trong sessionStorage: hỏi máy chủ theo cookie vé.
  useEffect(() => {
    if (devices.length > 0) return;
    fetch("/api/auth/learner/device/select")
      .then((res) => res.json() as Promise<{ devices: Device[] }>)
      .then((data) => setDevices(data.devices))
      .catch(() => setDevices([]));
  }, [devices.length]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function replace(id: string) {
    setBusy(true);
    const { data } = await postJson<{ next: string }>("/api/auth/learner/device/select", {
      deviceKey: await getDeviceKey(), replaceDeviceId: id,
    });
    setBusy(false);
    sessionStorage.removeItem(DEVICES_KEY);
    // Tải lại toàn trang: app học dựng lại dữ liệu offline theo người dùng mới.
    if (data.next === "done") return window.location.assign(sessionStorage.getItem(NEXT_KEY) ?? "/hoc");
    setError("Phiên chọn máy đã hết hạn. Đăng nhập lại để thử tiếp.");
  }

  return (
    <div>
      <h1 className={styles.title}>Tài khoản đã dùng trên 2 máy</h1>
      <p className={styles.lead}>Chọn một máy để thay bằng máy này. Máy được chọn sẽ bị đăng xuất.</p>
      <ul className={styles.list}>
        {devices.map((d) => (
          <li key={d.id} className={styles.device}>
            <span>
              {d.label}
              <br />
              <span className={styles.note}>
                {d.lastSeenAt ? `Dùng lần cuối ${new Date(d.lastSeenAt).toLocaleString("vi-VN")}` : "Chưa dùng"}
              </span>
            </span>
            <button className={styles.secondary} style={{ width: "auto" }} disabled={busy} onClick={() => replace(d.id)}>Thay máy này</button>
          </li>
        ))}
      </ul>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.link} onClick={() => router.push("/dang-nhap")}>← Quay lại đăng nhập</button>
    </div>
  );
}
