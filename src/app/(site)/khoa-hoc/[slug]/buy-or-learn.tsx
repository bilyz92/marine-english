"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ui from "@/components/ui.module.css";

type State = "loading" | "owned" | "buy" | "error";

/**
 * UC-03 A3: học viên đã có khóa thì thấy “Vào học” thay cho nút mua; khách chưa đăng nhập (401) hay chưa có khóa thì thấy nút mua.
 * Chưa biết thì chưa hiện nút nào, lỗi thì cho thử lại; kết quả của khóa cũ bị bỏ khi đổi khóa.
 */
export function BuyOrLearn({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0);
  // Kết quả gắn với lần hỏi (khóa + lần thử): khác lần hỏi hiện tại thì coi như đang tải.
  const key = `${slug}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const state: State = result?.key === key ? result.state : "loading";
  useEffect(() => {
    const controller = new AbortController();
    const settle = (next: State) => setResult({ key, state: next });
    fetch(`/api/me/enrollment?course=${encodeURIComponent(slug)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) return settle("buy");
        if (!res.ok) return settle("error");
        settle(((await res.json()) as { enrolled: boolean }).enrolled ? "owned" : "buy");
      })
      .catch(() => { if (!controller.signal.aborted) settle("error"); });
    return () => controller.abort();
  }, [slug, key]);

  if (state === "owned") return <Link className={ui.action} href={`/hoc?khoa=${slug}`}>Vào học</Link>;
  if (state === "buy") return <Link className={ui.action} href={`/mua/${slug}`}>Mua khóa học</Link>;
  if (state === "error") return <button type="button" className={ui.outline} onClick={() => setAttempt(attempt + 1)}>Không tải được, thử lại</button>;
  return <span className={ui.muted} role="status">Đang kiểm tra…</span>;
}
