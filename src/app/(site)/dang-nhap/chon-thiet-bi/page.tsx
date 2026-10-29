import styles from "../login.module.css";
import { ChooseDevice } from "./choose-device";

export default function ChooseDevicePage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <ChooseDevice />
      </div>
    </main>
  );
}
