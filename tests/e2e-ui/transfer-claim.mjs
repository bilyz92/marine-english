// Chưa có SePay (chủ quyết định 03/11/2026): khách bấm "Tôi đã chuyển khoản" là học ngay; chủ "Không thấy tiền" → khách thấy lý do,
// gửi ảnh chứng minh; chủ xem ảnh rồi "Duyệt". node tests/e2e-ui/transfer-claim.mjs <địa chỉ gốc> <mã khóa đang bán> <ảnh PNG/JPG> <thư mục ảnh>
// Dev server: đủ cấu hình nhận tiền, SEPAY_WEBHOOK_SECRETS rỗng. Cần MIGRATOR_DATABASE_URL (tạo tài khoản chủ thử).
import { mkdirSync, realpathSync } from "node:fs";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, IMAGE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9452 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms = 90000) => waitFor(async () => (await text()).includes(s), ms);
const click = async (label, scope = "document") => {
  const ok = await waitFor(() => b.evaluate(`(() => { const el = [...${scope}.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); if (!el) return false; el.click(); return true; })()`), 90000);
  if (!ok) check(`bấm được “${label}”`, false);
  return ok;
};
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("main button, dialog button, form button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 40000);
const setTextarea = (value) => b.evaluate(`(() => {
  const el = document.querySelector("dialog[open] textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
})()`);

const stamp = Date.now();
const email = `chu${stamp}@x.vn`;
const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1, 'owner', 'active', now(), now() + interval '7 days', now())`, [email]);
const REASON = "Sao kê BIDV chưa có khoản 199.000đ";

try {
  // 1. Khách đặt đơn rồi bấm "Tôi đã chuyển khoản".
  await b.width(390, 1000);
  await b.go(`${BASE}/khoa-hoc`);
  const code = await b.evaluate(`(async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "09" + String(Date.now()).slice(-8), password: "mat-khau-thu-123", displayName: "Khách báo chuyển", rank: null, deviceKey, deviceLabel: "Máy thử" }) });
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner=")).split("=")[1];
    const r = await fetch("/api/me/orders", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ courseSlug: ${JSON.stringify(SLUG)}, acceptTerms: true }) });
    return (await r.json()).code;
  })()`);
  check("tạo được đơn", /^ME/.test(code ?? ""), String(code));
  await b.go(`${BASE}/thanh-toan/${code}`);
  check("trang thanh toán có nút Tôi đã chuyển khoản", await see("Tôi đã chuyển khoản"));
  await hydrated();
  await b.shot(`${OUT}/1-thanh-toan-co-nut.png`);
  await click("Tôi đã chuyển khoản");
  check("bấm xong → Khóa học đã mở, có Vào học ngay", (await see("Khóa học đã mở")) && (await see("Vào học ngay")));
  await b.shot(`${OUT}/2-da-mo-tam.png`);

  // 2. Chủ đăng nhập (link một lần ở hộp thư giả), lọc "Chờ đối soát", bấm Không thấy tiền.
  await b.width(1280, 1000);
  await b.evaluate(`fetch("/api/auth/admin/link/send", { method: "POST", headers: { "content-type": "application/json", origin: location.origin }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) })`);
  await sleep(500);
  const inbox = await b.evaluate(`fetch("/dev/thu").then((r) => r.text())`);
  const link = inbox.slice(inbox.lastIndexOf(email)).match(/href="([^"]+#link=[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  await b.go("about:blank");
  await b.go(link);
  await hydrated();
  await click("Vào trang quản trị");
  await waitFor(async () => (await b.evaluate("location.pathname")) === "/admin");
  await b.go(`${BASE}/admin/don-hang`);
  await see("Chờ đối soát");
  await b.evaluate(`(() => { const s = document.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "claimed"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  check("lọc Chờ đối soát thấy đơn, nhãn Mở tạm", (await see(code)) && (await see("Mở tạm · chờ đối soát")));
  await b.shot(`${OUT}/3-admin-cho-doi-soat.png`);
  await click("Chưa nhận");
  await see("Lý do (khách sẽ thấy)");
  await setTextarea(REASON);
  await click("Chưa nhận: khóa lại khóa học", `document.querySelector("dialog[open]")`);
  check("khóa lại xong", await see(`Đã khóa lại đơn ${code}`));

  // 3. Khách thấy khóa học bị khóa, lý do, gửi ảnh chứng minh.
  await b.width(390, 1000);
  await b.go(`${BASE}/thanh-toan/${code}`);
  check("khách thấy Khóa học tạm khóa + Tiền chưa được xác nhận + lý do", (await see("Khóa học tạm khóa")) && (await see("Tiền chưa được xác nhận")) && (await see(REASON)));
  await hydrated();
  await click("Gửi ảnh chứng minh đã chuyển khoản");
  await see("Gửi bằng chứng đã chuyển khoản");
  await b.send("DOM.getDocument");
  const { result } = await b.send("Runtime.evaluate", { expression: `document.querySelector("dialog[open] input[type=file]")` });
  const node = await b.send("DOM.requestNode", { objectId: result.result.objectId });
  await b.send("DOM.setFileInputFiles", { files: [realpathSync(IMAGE)], nodeId: node.result.nodeId });
  await b.shot(`${OUT}/4-hop-gui-anh.png`);
  await click("Gửi ảnh", `document.querySelector("dialog[open]")`);
  check("gửi ảnh xong", await see("Đã gửi. Chủ khóa học sẽ kiểm tra"));
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn, nút có tên", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/5-da-gui-anh.png`);
  await click("Đóng", `document.querySelector("dialog[open]")`);
  await b.go(`${BASE}/tai-khoan/thanh-toan`);
  check("Lịch sử thanh toán cũng hiện khóa + lý do", (await see("Khóa học tạm khóa")) && (await see(REASON)));

  // 4. Chủ xem ảnh, Duyệt; khách thấy thanh toán thành công.
  await b.width(1280, 1000);
  await b.go(`${BASE}/admin/don-hang`);
  await b.evaluate(`(() => { const s = document.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "claimed"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  check("đơn có ảnh mới quay lại Chờ đối soát", (await see(code)) && (await see("Có ảnh mới")));
  await click("Ảnh khách gửi (1)");
  check("ảnh hiện ra", await waitFor(() => b.evaluate(`[...document.querySelectorAll("figure img")].some((i) => i.complete && i.naturalWidth > 0)`)));
  await b.shot(`${OUT}/6-admin-xem-anh.png`);
  await click("Đã nhận");
  await see("Mã giao dịch trên sao kê");
  check("ô giờ chuyển trên sao kê để trống, bắt buộc", await b.evaluate(`(() => { const i = document.querySelector("dialog[open] input[type=datetime-local]"); return !!i && i.required && i.value === ""; })()`));
  await b.evaluate(`(() => {
    const i = document.querySelector("dialog[open] input[type=datetime-local]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, i.max);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await click("Đã nhận: mở hẳn khóa học", `document.querySelector("dialog[open]")`);
  check("duyệt xong", await see(`Đã duyệt đơn ${code}`));
  await b.width(390, 1000);
  await b.go(`${BASE}/thanh-toan/${code}`);
  check("khách thấy Thanh toán thành công, Vào học ngay", (await see("Thanh toán thành công")) && (await see("Vào học ngay")));
  await b.shot(`${OUT}/7-da-duyet.png`);
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  b.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
