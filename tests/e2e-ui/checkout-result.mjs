// Kết quả thanh toán qua SePay: chuyển thiếu → "Đã nhận tiền, đang đối chiếu" (đã nhận / còn thiếu); chuyển đủ đơn khác → "Thanh toán thành công".
// node tests/e2e-ui/checkout-result.mjs <địa chỉ gốc> <mã khóa đang bán> <thư mục ảnh>
// Dev server bật SePay (SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO, SEPAY_WEBHOOK_SECRETS) và đủ cấu hình nhận tiền; script đọc cùng biến
// môi trường đó để ký webhook như SePay (HMAC-SHA256 của "{timestamp}.{thân}").
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const SECRET = (process.env.SEPAY_WEBHOOK_SECRETS ?? "").split(",")[0]?.split(":").slice(1).join(":");
if (!SECRET) throw new Error("Cần SEPAY_WEBHOOK_SECRETS giống dev server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9452 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const vnNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

/** Gửi webhook như SePay: tiền vào tài khoản đang theo dõi, nội dung là mã đơn. */
async function webhook(code, amount) {
  const body = JSON.stringify({
    id: Date.now(), gateway: process.env.SEPAY_BANK_CODE, accountNumber: process.env.SEPAY_ACCOUNT_NO, transactionDate: vnNow(),
    transferType: "in", transferAmount: amount, content: `${code} chuyen tien`, referenceCode: `FT${Date.now()}`, code,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const r = await fetch(`${BASE}/api/payments/sepay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-sepay-timestamp": ts, "x-sepay-signature": `sha256=${sig}` }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function newOrder() {
  return b.evaluate(`(async () => {
    const r = await fetch("/api/me/orders", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner=")).split("=")[1] }, body: JSON.stringify({ courseSlug: ${JSON.stringify(SLUG)}, acceptTerms: true }) });
    const j = await r.json();
    return j.code ? { code: j.code, amount: j.amountDueVnd } : { error: JSON.stringify(j) };
  })()`);
}

try {
  await b.width(390, 1000);
  await b.go(`${BASE}/khoa-hoc`);
  await b.evaluate(`(async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "09" + String(Date.now()).slice(-8), password: "mat-khau-thu-123", displayName: "Khách thử SePay", rank: null, deviceKey, deviceLabel: "Máy thử" }) });
  })()`);

  // 1. Chuyển thiếu 10.000đ: đơn chưa mở, trang báo đã nhận bao nhiêu, còn thiếu bao nhiêu, đừng chuyển lại.
  const short = await newOrder();
  check("tạo đơn 1", /^ME/.test(short.code ?? ""), short.error);
  await b.go(`${BASE}/thanh-toan/${short.code}`);
  check("đơn 1: trang chờ thanh toán", await see("Thanh toán đơn", 180000));
  await b.shot(`${OUT}/1-cho-thanh-toan-390.png`);
  const r1 = await webhook(short.code, short.amount - 10_000);
  check("webhook chuyển thiếu được nhận", r1.status === 200 && r1.body?.success === true, JSON.stringify(r1));
  check("đơn 1: báo đã nhận tiền, đang đối chiếu (trang tự cập nhật)", await see("Đã nhận tiền, đang đối chiếu"));
  check("đơn 1: ghi rõ còn thiếu 10.000", (await text()).includes("Còn thiếu 10.000"));
  check("đơn 1: chưa mở khóa", !(await text()).includes("Thanh toán thành công"));
  check("đơn 1: không còn QR mời chuyển cả đơn lần nữa", await waitFor(async () => !(await text()).includes("Dùng app ngân hàng quét mã QR"), 15000));
  const p1 = await b.evaluate(PAGE_CHECKS);
  check("đơn 1: không lỗi giao diện @390", p1.length === 0, JSON.stringify(p1));
  await b.shot(`${OUT}/2-chuyen-thieu-390.png`);

  // 2. Chuyển đủ đơn khác: tự mở khóa, trang chuyển sang "Thanh toán thành công".
  const full = await newOrder();
  check("tạo đơn 2", /^ME/.test(full.code ?? ""), full.error);
  await b.go(`${BASE}/thanh-toan/${full.code}`);
  await see("Thanh toán đơn");
  const r2 = await webhook(full.code, full.amount);
  check("webhook chuyển đủ được nhận", r2.status === 200, JSON.stringify(r2));
  check("đơn 2: tự chuyển sang Thanh toán thành công", await see("Thanh toán thành công"));
  check("đơn 2: có nút Vào học ngay", await see("Vào học ngay", 15000));
  const p2 = await b.evaluate(PAGE_CHECKS);
  check("đơn 2: không lỗi giao diện @390", p2.length === 0, JSON.stringify(p2));
  await b.shot(`${OUT}/3-thanh-cong-390.png`);
  await b.width(1280, 900);
  await sleep(300);
  await b.shot(`${OUT}/3-thanh-cong-1280.png`);
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
