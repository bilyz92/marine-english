"use client";

import { useEffect, useState } from "react";
import { loadMyCourses, type Identity, type MyCourse } from "@/lib/offline/engine";
import { go } from "./learn-app";
import styles from "./learn.module.css";

export function CourseList({ identity }: { identity: Identity }) {
  const [courses, setCourses] = useState<MyCourse[] | null>(null);

  useEffect(() => {
    void loadMyCourses(identity).then(setCourses);
  }, [identity]);

  if (!courses) return <p className={styles.muted}>Đang tải khóa học…</p>;
  return (
    <div className={styles.card}>
      <h1 className={styles.h1}>Khóa học của tôi</h1>
      {courses.length === 0 && <p className={styles.muted}>Anh/chị chưa có khóa học nào. Khóa đã mua sẽ hiện ở đây sau khi chuyển khoản được xác nhận.</p>}
      <ul className={styles.list}>
        {courses.map((c) => (
          <li key={c.slug}>
            <button className={styles.row} onClick={() => go({ khoa: c.slug })}>
              <span className={styles.rowTitle}>{c.titleVi}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
