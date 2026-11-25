import type { Metadata } from "next";
import styles from "../login.module.css";
import { ChooseDevice } from "./choose-device";

export const metadata: Metadata = { title: "Chọn thiết bị", robots: { index: false } };

export default function ChooseDevicePage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <ChooseDevice />
      </div>
    </main>
  );
}
