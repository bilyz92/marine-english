// Trang thanh toán có QR dựng theo đơn (CHECKOUT_BANK_BIN). node tests/e2e-ui/checkout-qr.mjs <địa chỉ gốc> <mã khóa đang bán> <thư mục ảnh>
// Dev server cần đủ cấu hình nhận tiền (kể cả CHECKOUT_BANK_BIN). Tạo học viên thử bằng số + mật khẩu và một đơn qua API.
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9451 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);

try {
  await b.width(390, 1000);
  await b.go(`${BASE}/khoa-hoc`);
  const code = await b.evaluate(`(async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const phone = "09" + String(Date.now()).slice(-8);
    await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password: "mat-khau-thu-123", displayName: "Khách thử QR", rank: null, deviceKey, deviceLabel: "Máy thử" }) });
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner=")).split("=")[1];
    const r = await fetch("/api/me/orders", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ courseSlug: ${JSON.stringify(SLUG)}, acceptTerms: true }) });
    return (await r.json()).code;
  })()`);
  check("tạo được đơn", /^ME/.test(code ?? ""), String(code));
  await b.go(`${BASE}/thanh-toan/${code}`);
  check("có khung quét QR", await see("Dùng app ngân hàng quét mã QR"));
  check("QR dựng tại chỗ (ảnh data:, không gọi ra ngoài)", await waitFor(() => b.evaluate(`document.querySelector('section[aria-label="Chuyển khoản"] img')?.src.startsWith("data:image/png")`)));
  check("ghi QR đã có sẵn số tiền và nội dung", await see("Mã QR đã có sẵn số tiền và nội dung"));
  const t = await text();
  check("có số tiền to và 4 dòng Ngân hàng / Số tài khoản / Chủ tài khoản / Nội dung", ["Số tiền thanh toán", "Ngân hàng", "Số tài khoản", "Chủ tài khoản", "Nội dung", code].every((s) => t.includes(s)));
  check("4 nút Copy", (await b.evaluate(`document.querySelectorAll('button[aria-label^="Copy "]').length`)) === 4);
  check("chưa có SePay → báo xác nhận tay, không hứa tự mở", t.includes("khóa học mở khi tiền được xác nhận"));
  const outside = b.events.requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
  check("không gọi ra ngoài domain", outside.length === 0, outside.slice(0, 3).join(" "));
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn, nút có tên", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/thanh-toan-qr-390.png`);
  await b.width(1280, 1000);
  await b.shot(`${OUT}/thanh-toan-qr-1280.png`);
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
