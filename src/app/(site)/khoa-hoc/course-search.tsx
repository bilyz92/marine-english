"use client";

import { useEffect, useRef, useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "./course-search.module.css";
import { matchesCourse } from "@/lib/client/course-search";
import type { CourseCard as Course } from "@/modules/content/catalog";
import { CourseCard } from "../course-card";

/** Ô tìm khóa học (lọc ngay khi gõ). Mở từ menu điện thoại với ?tim=1 thì con trỏ vào ô tìm luôn. */
export function CourseSearch({ courses }: { courses: Course[] }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tim") === "1") input.current?.focus();
  }, []);
  const shown = courses.filter((c) => matchesCourse(c, query));
  return (
    <>
      <label className={styles.field}>
        <span className={styles.label}>Tìm khóa học</span>
        <input ref={input} id="tim-khoa-hoc" className={styles.input} type="search" enterKeyHint="search" placeholder="Ví dụ: tàu dầu, container, oiler" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className={ui.muted} role="status">{query.trim() ? `${shown.length} khóa khớp “${query.trim()}”` : `${courses.length} khóa đang mở bán`}</p>
      {shown.length === 0
        ? <p className={ui.notice}>Không thấy khóa nào khớp. Thử từ khác, ví dụ tên loại tàu.</p>
        : <div className={ui.grid}>{shown.map((c) => <CourseCard key={c.slug} course={c} />)}</div>}
    </>
  );
}
