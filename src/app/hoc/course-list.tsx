"use client";

import { useCallback, useEffect, useState } from "react";
import { loadMyCourses, type Identity, type MyCourse } from "@/lib/offline/engine";
import { go } from "./learn-app";
import styles from "./learn.module.css";

export function CourseList({ identity }: { identity: Identity }) {
  // undefined: đang tải; null: chưa kết nối được và máy chưa lưu danh sách.
  const [courses, setCourses] = useState<MyCourse[] | null | undefined>(undefined);
  const load = useCallback(() => {
    setCourses(undefined);
    void loadMyCourses(identity).then(setCourses);
  }, [identity]);

  useEffect(() => {
    void loadMyCourses(identity).then(setCourses);
  }, [identity]);

  if (courses === undefined) return <p className={styles.muted}>Đang tải khóa học…</p>;
  if (courses === null) {
    return (
      <div className={styles.card}>
        <h1 className={styles.h1}>Chưa tải được khóa học</h1>
        <p className={styles.muted}>Mạng đang chậm hoặc mất kết nối. Khóa của bạn vẫn còn, kiểm tra mạng rồi thử lại.</p>
        <p><button className={styles.primary} onClick={load}>Thử lại</button></p>
      </div>
    );
  }
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
