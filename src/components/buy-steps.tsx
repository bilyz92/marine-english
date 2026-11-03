import styles from "./buy-steps.module.css";

const STEPS = ["Thông tin", "Quét VietQR", "Vào học"];

/** Các bước mua, dùng chung cho trang thông tin và trang thanh toán. */
export function BuySteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className={styles.steps} aria-label="Các bước mua">
      {STEPS.map((label, i) => (
        <li key={label} className={i + 1 === current ? styles.now : styles.step} aria-current={i + 1 === current ? "step" : undefined}>{i + 1} · {label}</li>
      ))}
    </ol>
  );
}
