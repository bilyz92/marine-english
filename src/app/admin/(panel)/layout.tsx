import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = { title: "Quản trị", robots: { index: false } };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
