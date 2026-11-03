import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand-mark";
import ui from "@/components/ui.module.css";
import { SiteNav } from "./site-nav";
import styles from "./site.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`${ui.wrap} ${styles.headerRow}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo}>
            <BrandMark />
          </span>
          Marine English
        </Link>
        <Suspense fallback={null}><SiteNav /></Suspense>
      </div>
    </header>
  );
}
