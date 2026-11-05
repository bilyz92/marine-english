// Menu điện thoại của học viên: node tests/e2e-ui/learner-nav.mjs <địa chỉ gốc> <thư mục ảnh>
// Tạo học viên thử bằng số + mật khẩu qua API; cần ít nhất một khóa đang bán để kiểm tìm kiếm.
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9449 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("a,button"); return !!el && Object.keys(el).some((k) => k.startsWith("__react")); })()`), 30000);
const navVisible = () => b.evaluate(`(() => { const n = document.querySelector('nav[aria-label="Menu học viên"]'); return !!n && getComputedStyle(n).display !== "none"; })()`);
const navLabels = () => b.evaluate(`[...document.querySelectorAll('nav[aria-label="Menu học viên"] a')].map((a) => a.textContent.trim())`);
const tap = (label) => b.evaluate(`[...document.querySelectorAll('nav[aria-label="Menu học viên"] a')].find((a) => a.textContent.trim() === ${JSON.stringify(label)}).click()`);
const path = () => b.evaluate("location.pathname + location.search");

try {
  await b.width(390, 844);
  await b.go(`${BASE}/`);
  await hydrated();
  check("chưa đăng nhập → không có menu học viên", !(await navVisible()));

  const phone = `09${String(Date.now()).slice(-8)}`;
  const reg = await b.evaluate(`(async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const r = await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: ${JSON.stringify(phone)}, password: "mat-khau-thu-123", displayName: "Học viên menu", rank: null, deviceKey, deviceLabel: "Điện thoại thử" }) });
    return (await r.json()).next;
  })()`);
  check("tạo học viên thử", reg === "done", String(reg));

  await b.go(`${BASE}/`);
  await hydrated();
  check("đã đăng nhập, điện thoại → có menu", await waitFor(navVisible, 10000));
  check("đủ 5 mục", JSON.stringify(await navLabels()) === JSON.stringify(["Trang chủ", "Khóa học", "Khóa của tôi", "Thanh toán", "Tìm kiếm"]), JSON.stringify(await navLabels()));
  check("thanh trên cùng ghi Tài khoản thay cho Đăng nhập", await b.evaluate(`(() => { const h = document.querySelector("header nav"); return h.innerText.includes("Tài khoản") && !h.innerText.includes("Đăng nhập"); })()`));
  check("trang chủ đang chọn", await b.evaluate(`document.querySelector('nav[aria-label="Menu học viên"] a[aria-current="page"]')?.textContent.trim() === "Trang chủ"`));
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/menu-trang-chu-390.png`);

  await tap("Thanh toán");
  check("Thanh toán → Lịch sử thanh toán", (await waitFor(async () => (await path()) === "/tai-khoan/thanh-toan")) && (await see("Lịch sử thanh toán")) && (await see("Chưa có đơn nào")));
  await b.shot(`${OUT}/lich-su-thanh-toan-390.png`);

  await tap("Tìm kiếm");
  check("Tìm kiếm → trang Khóa học, con trỏ ở ô tìm", (await waitFor(async () => (await path()) === "/khoa-hoc?tim=1")) && (await waitFor(() => b.evaluate(`document.activeElement?.type === "search"`), 10000)));
  const total = await b.evaluate(`document.querySelectorAll("article").length`);
  await b.evaluate(`(() => { const el = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "khong co khoa nao nhu the"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  check("gõ từ không khớp → báo không thấy", await see("Không thấy khóa nào khớp"));
  const firstTitle = await b.evaluate(`(async () => { const r = await fetch("/api/public/courses"); const j = await r.json(); return (j.courses ?? j)[0]?.titleVi ?? null; })()`).catch(() => null);
  if (firstTitle && total > 0) {
    const word = firstTitle.normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ").slice(-2).join(" ");
    await b.evaluate(`(() => { const el = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(word)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("gõ không dấu → vẫn tìm thấy khóa", await waitFor(async () => (await b.evaluate(`document.querySelectorAll("article").length`)) >= 1), word);
  }
  await b.shot(`${OUT}/tim-khoa-hoc-390.png`);

  // Đang ở trang Khóa học: bấm Tìm kiếm lần nữa vẫn đưa con trỏ vào ô tìm.
  await b.evaluate(`document.activeElement?.blur(); window.scrollTo(0, document.body.scrollHeight)`);
  await tap("Tìm kiếm");
  check("bấm Tìm kiếm khi đang ở trang Khóa học → con trỏ vào ô tìm", await waitFor(() => b.evaluate(`document.activeElement?.id === "tim-khoa-hoc"`), 5000));

  await tap("Khóa của tôi");
  check("Khóa của tôi → app học", await waitFor(async () => (await path()).startsWith("/hoc")));

  // Học viên đã đăng nhập mở bài học thử trên điện thoại: hàng Trước / Tiếp theo dính đáy nằm trên menu, không bị che.
  await b.go(`${BASE}/khoa-hoc`);
  await hydrated();
  const slug = await b.evaluate(`[...document.querySelectorAll('a[href^="/khoa-hoc/"]')].map((a) => a.getAttribute("href").split("/")[2]).find(Boolean)`);
  await b.go(`${BASE}/khoa-hoc/${slug}/hoc-thu/1`);
  const dockClear = await waitFor(async () => b.evaluate(`(() => {
    const next = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Tiếp theo"));
    const nav = document.querySelector('nav[aria-label="Menu học viên"]');
    if (!next || !nav) return false;
    window.scrollTo(0, 0);
    return next.parentElement.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top + 1;
  })()`), 60000);
  check("bài học thử: hàng Trước/Tiếp theo không bị menu đáy che", dockClear);

  await b.width(1280, 900);
  await b.go(`${BASE}/khoa-hoc`);
  await hydrated();
  check("máy tính → không hiện menu dưới đáy", !(await navVisible()));
  await b.go(`${BASE}/admin/dang-nhap`);
  await hydrated();
  await b.width(390, 844);
  check("khu quản trị → không hiện menu học viên", !(await navVisible()));
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
