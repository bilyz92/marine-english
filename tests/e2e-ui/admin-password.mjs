// D3: quản trị đặt mật khẩu rồi đăng nhập bằng email + mật khẩu. node tests/e2e-ui/admin-password.mjs <địa chỉ gốc> <thư mục ảnh>
// Cần MIGRATOR_DATABASE_URL (tạo tài khoản thử); máy chủ chạy bản dev (lấy link đăng nhập lần đầu từ hộp thư giả).
import { mkdirSync } from "node:fs";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9448 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const click = async (label) => { const ok = await waitFor(() => b.evaluate(`(() => { const el = [...document.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); if (!el) return false; el.click(); return true; })()`), 15000); if (!ok) check(`bấm được “${label}”`, false); return ok; };
const fill = (label, value) => b.evaluate(`(() => {
  const field = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
  const el = field?.querySelector("input");
  if (!el) throw new Error("không có ô " + ${JSON.stringify(label)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
const submit = (label) => b.evaluate(`(() => { const el = [...document.querySelectorAll("form button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!el) throw new Error("không có nút ${label}"); el.click(); })()`);
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 30000);
const path = () => b.evaluate("location.pathname");

const stamp = Date.now();
const email = `chu${stamp}@x.vn`;
const PW = "tau-dau-2026-thu";
const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1, 'owner', 'active', now(), now() + interval '7 days', now())`, [email]);

try {
  // Màn đăng nhập giống màn học viên: menu site, ô Email + Mật khẩu, không có Tạo tài khoản.
  await b.width(1280);
  await b.go(`${BASE}/admin/dang-nhap`);
  await hydrated();
  const login = await text();
  check("màn đăng nhập có menu site, ô Email, Mật khẩu, nút Đăng nhập", ["Khóa học", "Đăng nhập quản trị", "Email", "Mật khẩu", "Quên mật khẩu?"].every((s) => login.includes(s)));
  check("không có Tạo tài khoản", !login.includes("Tạo tài khoản"));
  await b.shot(`${OUT}/dang-nhap-quan-tri.png`);

  // Chưa có mật khẩu: sai → báo lỗi chung.
  await fill("Email", email);
  await fill("Mật khẩu", PW);
  await submit("Đăng nhập");
  check("chưa đặt mật khẩu → báo email hoặc mật khẩu không đúng", await see("Email hoặc mật khẩu không đúng"));

  // Lần đầu vào bằng link, đặt mật khẩu.
  await b.evaluate(`fetch("/api/auth/admin/link/send", { method: "POST", headers: { "content-type": "application/json", origin: location.origin }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) })`);
  await sleep(500);
  const inbox = await b.evaluate(`fetch("/dev/thu").then((r) => r.text())`);
  const link = inbox.slice(inbox.lastIndexOf(email)).match(/href="([^"]+#link=[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  await b.go("about:blank");
  await b.go(link);
  await hydrated();
  await click("Vào trang quản trị");
  await waitFor(async () => (await path()) === "/admin");
  check("chưa có mật khẩu → dải nhắc đặt mật khẩu", await see("Chưa đặt mật khẩu"), `${await path()} · ${(await text()).slice(0, 300)} · link=${String(link).slice(0, 60)}`);
  await click("Mật khẩu");
  await see("Mật khẩu mới");
  // Chữ hiện trước khi React gắn vào ô nhập: điền sớm thì giá trị bị mất (máy chậm), nên chờ ô nhập sẵn sàng.
  await waitFor(() => b.evaluate(`(() => { const el = document.querySelector("main input[type=password]"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 60000);
  await fill("Mật khẩu mới", PW);
  await fill("Nhập lại mật khẩu mới", PW);
  await click("Lưu mật khẩu");
  check("đặt mật khẩu xong, dải nhắc biến mất", (await see("Đã lưu mật khẩu")) && !(await text()).includes("Chưa đặt mật khẩu"), `${await path()} · ${(await text()).slice(0, 500)}`);
  await click("Đăng xuất");
  await waitFor(async () => (await path()) === "/admin/dang-nhap");

  // Đăng nhập bằng email + mật khẩu.
  await hydrated();
  await fill("Email", email.toUpperCase());
  await fill("Mật khẩu", "sai-mat-khau-roi");
  await submit("Đăng nhập");
  check("sai mật khẩu → báo lỗi", await see("Email hoặc mật khẩu không đúng"));
  await fill("Mật khẩu", PW);
  await submit("Đăng nhập");
  check("đúng mật khẩu → vào tổng quan", (await waitFor(async () => (await path()) === "/admin")) && (await see("Tiền đã nhận", 30000)));

  await b.go(`${BASE}/admin/dang-nhap`);
  await hydrated();
  await b.width(360, 800);
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn, ô có nhãn", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/dang-nhap-quan-tri-360.png`);
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  await db.end();
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
