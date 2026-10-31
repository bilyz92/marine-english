// Luồng mua thật trên trình duyệt, webhook có chữ ký giả lập (giao dịch thật chờ G4/G5).
// node tests/e2e-ui/purchase.mjs <địa chỉ gốc> <mã khóa> <thư mục ảnh>; cần SEPAY_WEBHOOK_SECRETS, SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO. Máy chủ chạy bản dev để lấy mã từ hộp thư giả.
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser();
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const click = (label) => b.evaluate(`(() => { const el = [...document.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`);
const setValue = (selector, value) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
// Đợi React gắn xong vào phần tử form; thao tác sớm hơn sẽ bị bỏ qua.
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("form input, form button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 40000);
const problems = async (where) => { const list = await b.evaluate(PAGE_CHECKS); check(`không lỗi giao diện: ${where}`, list.length === 0, JSON.stringify(list)); };

try {
  await b.width(390);
  // 1. Chưa đăng nhập vào trang mua → sang đăng nhập, giữ đường về.
  await b.go(`${BASE}/mua/${SLUG}`);
  check("chưa đăng nhập → trang đăng nhập có next", (await b.evaluate("location.pathname + location.search")).startsWith(`/dang-nhap?next=%2Fmua%2F${SLUG}`));

  // 2. Đăng nhập bằng mã qua đúng giao diện.
  const email = `mua${Date.now()}@x.vn`;
  check("form đăng nhập hiện", await waitFor(() => b.evaluate(`document.querySelector("input[type=email]") !== null`), 40000));
  await hydrated();
  await setValue("input[maxlength='100']", "Người mua thử");
  await setValue("input[type=email]", email);
  await click("Gửi mã xác minh");
  // Server dev vừa khởi động phải biên dịch route gửi mã lần đầu: chờ lâu hơn.
  check("bước nhập mã nêu kênh gửi", await waitFor(async () => (await text()).includes(`qua email tới ${email}`), 90000));
  check("nút gửi lại đang đếm ngược", (await text()).includes("Gửi lại mã sau"));
  const inbox = await b.evaluate(`fetch("/dev/thu").then((r) => r.text())`);
  const code = inbox.slice(inbox.indexOf(email)).match(/\b\d{6}\b/)[0];
  await setValue("input[autocomplete='one-time-code']", code);
  await click("Xác minh");
  check("đăng nhập xong", await waitFor(async () => (await text()).includes("Đã tạo tài khoản")));
  await click("Tiếp tục");
  check("quay lại đúng trang mua", await waitFor(async () => (await b.evaluate("location.pathname")) === `/mua/${SLUG}`));
  await waitFor(async () => (await text()).includes("Sang thanh toán"));
  await hydrated();
  await problems("trang mua");
  await b.shot(`${OUT}/mua-390.png`);

  // 3. Chưa tích điều khoản → báo lỗi, không tạo đơn.
  await click("Sang thanh toán");
  check("chưa đồng ý → báo lỗi", await waitFor(async () => (await text()).includes("Cần đồng ý điều khoản")));
  check("ô điều khoản không tích sẵn", !(await b.evaluate(`document.querySelector("input[type=checkbox]").checked`)));
  await b.evaluate(`document.querySelector("input[type=checkbox]").click()`);
  await click("Sang thanh toán");
  check("sang trang thanh toán", await waitFor(async () => (await b.evaluate("location.pathname")).startsWith("/thanh-toan/ME")));
  await waitFor(async () => (await text()).includes("Thông tin chuyển khoản"));
  const orderCode = (await b.evaluate("location.pathname")).split("/").pop();
  check("hiện mã đơn và đếm ngược", (await text()).includes(orderCode) && /\d\d:\d\d/.test(await text()));
  await problems("trang thanh toán");
  for (const w of [360, 1280]) { await b.width(w); await sleep(200); await problems(`thanh toán @${w}`); await b.shot(`${OUT}/thanh-toan-${w}.png`); }
  await b.width(390);
  await b.shot(`${OUT}/thanh-toan-390.png`);

  // 4. Đóng trang rồi mở lại → đúng đơn; bấm mua lại → không có đơn thứ hai.
  await b.go(`${BASE}/khoa-hoc`);
  await b.go(`${BASE}/mua/${SLUG}`);
  await waitFor(async () => (await text()).includes("Sang thanh toán"));
  await hydrated();
  await b.evaluate(`document.querySelector("input[type=checkbox]").click()`);
  await click("Sang thanh toán");
  await waitFor(async () => (await b.evaluate("location.pathname")).startsWith("/thanh-toan/"));
  check("mua lại → đúng đơn cũ", (await b.evaluate("location.pathname")).endsWith(orderCode));

  // 5. Webhook có chữ ký → trang tự chuyển thành công.
  await waitFor(async () => (await text()).includes("Thông tin chuyển khoản"));
  const amount = await b.evaluate(`fetch("/api/me/orders/${orderCode}").then((r) => r.json()).then((o) => o.amountDueVnd)`);
  const vn = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const body = JSON.stringify({ id: Date.now(), gateway: process.env.SEPAY_BANK_CODE, accountNumber: process.env.SEPAY_ACCOUNT_NO, transferType: "in", transferAmount: amount, content: orderCode, referenceCode: `FT${Date.now()}`, transactionDate: vn });
  const ts = String(Math.floor(Date.now() / 1000));
  const secret = process.env.SEPAY_WEBHOOK_SECRETS.split(",")[0].split(":").slice(1).join(":");
  const hook = await fetch(`${BASE}/api/payments/sepay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-sepay-timestamp": ts, "x-sepay-signature": createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex") }, body });
  check("webhook nhận", hook.ok, String(hook.status));
  check("trang tự chuyển thành công", await waitFor(async () => (await text()).includes("Thanh toán thành công")));
  await b.shot(`${OUT}/thanh-cong-390.png`);
  await problems("thành công");
  check("có nút vào học", await click("Vào học ngay"));
  check("vào đúng khóa", await waitFor(async () => (await b.evaluate("location.pathname + location.search")) === `/hoc?khoa=${SLUG}`));

  // 6b. Học viên tự gửi yêu cầu hoàn tiền trên trang Tài khoản (FR-28, BR-18).
  await b.go(`${BASE}/tai-khoan`);
  check("trang tài khoản có đơn đã mua", await waitFor(async () => (await text()).includes(orderCode)));
  await hydrated();
  await click("Yêu cầu hoàn tiền");
  await waitFor(() => b.evaluate(`document.querySelector("textarea") !== null`));
  const set = (selector, value) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await set("textarea", "thử hoàn tiền");
  const inputs = await b.evaluate(`[...document.querySelectorAll("form input")].length`);
  await b.evaluate(`(() => { const els = [...document.querySelectorAll("form input")]; const vals = ["Vietcombank", "0011223344", "NGUYEN VAN THU"]; els.forEach((el, i) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, vals[i]); el.dispatchEvent(new Event("input", { bubbles: true })); }); })()`);
  check("form hoàn tiền có 3 ô tài khoản", inputs === 3, String(inputs));
  await click("Gửi yêu cầu hoàn tiền");
  check("gửi yêu cầu hoàn tiền xong", await waitFor(async () => (await text()).includes("Đã gửi yêu cầu hoàn tiền")));
  await b.shot(`${OUT}/tai-khoan-hoan-tien-390.png`);

  // 6. Mua lại khóa đã có: báo ngay khi mở trang, không cần tích điều khoản.
  await b.go(`${BASE}/mua/${SLUG}`);
  check("đã có khóa → báo ngay, có nút vào học", await waitFor(async () => (await text()).includes("Bạn đã có khóa")));
  check("không hiện ô điều khoản", await b.evaluate(`document.querySelector("input[type=checkbox]") === null`));

  const errors = b.events.errors.filter((e) => !String(e).includes("401"));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  b.close();
}
process.exit(failures.length ? 1 : 0);
