"use client";

import { useSyncExternalStore } from "react";

// Nút đổi Sáng / Tối (giao diện v2): mặc định theo máy; bấm thì nhớ trên máy này (localStorage), đặt data-theme trên <html>.
// Đoạn THEME_SCRIPT chạy trong <head> trước khi vẽ trang để không nháy sai màu.

const KEY = "me-theme";
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", fn);
  return () => { listeners.delete(fn); media.removeEventListener("change", fn); };
};
const isDark = () => {
  const set = document.documentElement.dataset.theme;
  return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* chế độ riêng tư: chỉ đổi trong lần mở này */ }
    for (const fn of listeners) fn();
  }
  return (
    <button type="button" className={className} onClick={toggle} aria-pressed={dark} aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}>
      {dark ? "Sáng" : "Tối"}
    </button>
  );
}
