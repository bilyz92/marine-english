"use client";

import { useState } from "react";
import { adminApi, fmtTime, LoadState, problemOf, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Job = { name: string; schedule: { everyMs?: number; dailyAt?: string }; lastRun: { status: string; startedAt: string; error: string | null } | null; lease: { holder: string } | null };

const scheduleText = (s: Job["schedule"]) => (s.dailyAt ? `Hằng ngày ${s.dailyAt} giờ Việt Nam` : `Mỗi ${Math.round((s.everyMs ?? 0) / 1000)} giây`);

export default function JobsPage() {
  const { data, reload, ...state } = useLoad<{ jobs: Job[] }>("/api/quan-tri/jobs");
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function runNow(name: string) {
    const r = await adminApi("/api/quan-tri/jobs", { method: "POST", body: { job: name } });
    const issue = problemOf(r);
    setProblem(issue);
    setNote(issue ? null : `Đã yêu cầu chạy ${name}. Worker sẽ nhận trong ít giây.`);
  }

  return (
    <>
      <h1 className={styles.h1}>Job</h1>
      {note && <p className={styles.ok} role="status">{note}</p>}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      <LoadState {...state} reload={reload} />
      {data && (
        <section className={styles.card}>
          {data.jobs.map((j) => (
            <div key={j.name} className={styles.item}>
              <div className={styles.itemText}>
                <span>{j.name}</span>
                <span className={styles.muted}>{scheduleText(j.schedule)}{j.lease ? " · đang chạy" : ""}</span>
                <span className={styles.muted}>{j.lastRun ? `Lần gần nhất ${fmtTime(j.lastRun.startedAt)}${j.lastRun.error ? `: ${j.lastRun.error}` : ""}` : "Chưa chạy lần nào"}</span>
              </div>
              {j.lastRun && <span className={j.lastRun.status === "success" ? styles.tagOk : j.lastRun.status === "failed" || j.lastRun.status === "timeout" ? styles.tagBad : styles.tag}>{j.lastRun.status}</span>}
              <button className={styles.btn} onClick={() => void runNow(j.name)}>Chạy ngay</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
