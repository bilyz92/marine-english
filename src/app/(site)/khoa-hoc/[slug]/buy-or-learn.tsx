"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ui from "@/components/ui.module.css";

/** UC-03 A3: học viên đã có khóa thì thấy “Vào học” thay cho nút mua; khách chưa đăng nhập vẫn thấy nút mua. */
export function BuyOrLearn({ slug }: { slug: string }) {
  const [enrolled, setEnrolled] = useState(false);
  useEffect(() => {
    void fetch(`/api/me/orders?course=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (res) => { if (res.ok) setEnrolled(((await res.json()) as { enrolled: boolean }).enrolled); })
      .catch(() => {});
  }, [slug]);
  return enrolled
    ? <Link className={ui.action} href={`/hoc?khoa=${slug}`}>Vào học</Link>
    : <Link className={ui.action} href={`/mua/${slug}`}>Mua khóa học</Link>;
}
