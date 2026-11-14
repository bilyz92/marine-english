import Link from "next/link";
import ui from "@/components/ui.module.css";
import { formatVnd } from "@/lib/format";
import type { CatalogGroup } from "@/modules/content/catalog";
import { CourseCard } from "../course-card";
import styles from "./course-groups.module.css";

// Danh mục khóa học (docs/superpowers/plans/2026-11-14-course-categories.md, Task 3). Ô có ảnh: ảnh của chủ đã in tên chức danh,
// nên tên chỉ nằm trong HTML cho trình đọc màn hình; ô không ảnh hiện tên Anh đậm + tên Việt trên nền nhạt.

export const groupHref = (key: string) => `/khoa-hoc?dm=${encodeURIComponent(key)}`;
const groupName = (g: Pick<CatalogGroup, "titleVi" | "titleEn">) => (g.titleEn ? `${g.titleEn} – ${g.titleVi}` : g.titleVi);

export function CourseBanner() {
  return (
    <section className={styles.banner} aria-labelledby="h-khoa-hoc">
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh nhỏ trong public/, trang trí */}
      <img className={styles.bannerImage} src="/images/khoa-hoc-banner.webp" alt="" width={410} height={160} />
      <div className={styles.bannerText}>
        <span className={styles.eyebrow}>Marine Engine Academy</span>
        <h1 id="h-khoa-hoc" className={styles.bannerTitle}>Khóa phỏng vấn ngành máy</h1>
      </div>
    </section>
  );
}

export function CategoryTiles({ groups }: { groups: CatalogGroup[] }) {
  return (
    <ul className={styles.tiles} aria-label="Chức danh">
      {groups.map((g) => (
        <li key={g.key}>
          <Link className={styles.tile} href={groupHref(g.key)} data-category-key={g.key}>
            {g.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh công khai theo nội dung (/media), kích thước cố định */}
                <img className={styles.tileImage} src={g.imageUrl} alt="" width={383} height={343} loading="lazy" />
                <span className={styles.srOnly}>{groupName(g)}</span>
              </>
            ) : (
              <span className={styles.tileName}>
                {g.titleEn && <strong className={styles.tileEn}>{g.titleEn}</strong>}
                <span className={g.titleEn ? styles.tileVi : styles.tileEn}>{g.titleVi}</span>
              </span>
            )}
            <span className={styles.tileMeta}>{g.courseCount} khóa · từ {formatVnd(g.minPriceVnd)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GroupView({ group }: { group: CatalogGroup }) {
  return (
    <>
      <div className={styles.groupHead}>
        <Link className={styles.back} href="/khoa-hoc">← Tất cả chức danh</Link>
        <h2 className={ui.h2}>{groupName(group)}</h2>
        <p className={ui.muted}>{group.courseCount} khóa · từ {formatVnd(group.minPriceVnd)}</p>
      </div>
      {group.courses.length > 0 && <div className={ui.grid}>{group.courses.map((c) => <CourseCard key={c.slug} course={c} />)}</div>}
      {group.subgroups.map((s) => (
        <section key={s.id} className={styles.sub} aria-labelledby={`dm-${s.id}`}>
          <h3 id={`dm-${s.id}`} className={ui.h3}>{s.titleVi}</h3>
          <div className={ui.grid}>{s.courses.map((c) => <CourseCard key={c.slug} course={c} />)}</div>
        </section>
      ))}
    </>
  );
}
