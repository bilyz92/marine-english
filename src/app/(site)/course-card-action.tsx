"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ui from "@/components/ui.module.css";
import { useSignedIn } from "@/components/learner-nav";
import { courseCardAction } from "@/lib/client/course-search";

// Nhiều thẻ cùng mở một lúc dùng chung một lần hỏi máy chủ. Hỏi lỗi hoặc quá giờ thì coi như chưa có khóa: vẫn có nút để mua, trang mua báo đúng nếu đã có.
let inFlight: Promise<string[]> | null = null;
function fetchOwned(): Promise<string[]> {
  inFlight ??= fetch("/api/me/courses", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
    .then(async (res) => (res.ok ? ((await res.json()) as { courses: { slug: string }[] }).courses.map((c) => c.slug) : []))
    .catch(() => [])
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function CourseCardAction({ slug }: { slug: string }) {
  const signedIn = useSignedIn();
  const [owned, setOwned] = useState<string[] | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetchOwned().then((slugs) => { if (live) setOwned(slugs); });
    return () => { live = false; };
  }, [signedIn]);
  const action = courseCardAction({ signedIn, owned, slug });
  if (action === "learn") return <Link className={ui.action} href={`/hoc?khoa=${slug}`}>Vào học</Link>;
  if (action === "buy") return <Link className={ui.action} href={`/mua/${slug}`}>Mua khóa</Link>;
  return null;
}
