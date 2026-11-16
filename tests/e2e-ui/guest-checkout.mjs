// Khách chưa có tài khoản đặt mua (chủ 16/11/2026, docs/superpowers/plans/2026-11-16-guest-orders.md, Task 5): chỉ tạo đơn; tiền về
// (webhook SePay) thì tài khoản mới được tạo và thông tin đăng nhập chỉ gửi qua email, trang đơn không hiện mật khẩu.
// node tests/e2e-ui/guest-checkout.mjs <địa chỉ gốc> <mã khóa đang bán> <thư mục ảnh>
// Dev server bật SePay (SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO, SEPAY_WEBHOOK_SECRETS) và đủ cấu hình nhận tiền; script đọc cùng biến để ký
// webhook. Cần MIGRATOR_DATABASE_URL (tạo dữ liệu thử, kiểm tài khoản đã tạo).
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const SECRET = (process.env.SEPAY_WEBHOOK_SECRETS ?? "").split(",")[0]?.split(":").slice(1).join(":");
if (!SECRET) throw new Error("Cần SEPAY_WEBHOOK_SECRETS giống dev server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9455 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const see = (s, ms = 120000) => waitFor(async () => (await text()).includes(s), ms);
const path = () => b.evaluate("location.pathname");
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("main form button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 60000);
// Điền theo nhãn: <label><span>Nhãn</span><input/></label>.
const fill = (label, value) => b.evaluate(`(() => {
  const field = [...document.querySelectorAll("main label")].find((l) => l.querySelector("span")?.textContent.trim() === ${JSON.stringify(label)});
  const el = field?.querySelector("input");
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
const tick = (labelText) => b.evaluate(`(() => { const l = [...document.querySelectorAll("main label")].find((x) => x.textContent.includes(${JSON.stringify(labelText)})); const i = l?.querySelector("input[type=checkbox]"); if (i && !i.checked) i.click(); return !!i; })()`);
const press = (label) => b.evaluate(`(() => { const el = [...document.querySelectorAll("main button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); el?.click(); return !!el; })()`);
const problems = async (where) => { const list = await b.evaluate(PAGE_CHECKS); check(`không lỗi giao diện: ${where}`, list.length === 0, JSON.stringify(list)); };
const openBuy = async (clear = true) => { if (clear) await b.send("Network.clearBrowserCookies"); await b.go(`${BASE}/mua/${SLUG}`); await see("Đặt hàng và thanh toán"); await hydrated(); };
const order = async (name, phone, email, confirm = email) => {
  await fill("Họ và tên *", name);
  await fill("Số điện thoại *", phone);
  await fill("Email *", email);
  await fill("Nhập lại email *", confirm);
  await tick("Tôi đồng ý");
  await press("Đặt hàng và thanh toán");
};
const vnNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
async function webhook(code, amount) {
  const body = JSON.stringify({
    id: Date.now(), gateway: process.env.SEPAY_BANK_CODE, accountNumber: process.env.SEPAY_ACCOUNT_NO, transactionDate: vnNow(),
    transferType: "in", transferAmount: amount, content: `${code} chuyen tien`, referenceCode: `FT${Date.now()}`, code,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const r = await fetch(`${BASE}/api/payments/sepay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-sepay-timestamp": ts, "x-sepay-signature": `sha256=${sig}` }, body });
  return r.status;
}

const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
const stamp = String(Date.now()).slice(-7);
const phone = `093${stamp}`;
const email = `khach${stamp}@x.vn`;

try {
  for (const w of [390, 1280]) {
    await b.width(w, 900);
    await openBuy();
    check(`khách mở trang mua thấy form, email bắt buộc (${w})`, (await text()).includes("Email *") && (await text()).includes("gửi thông tin đăng nhập vào email"));
    await problems(`form khách @${w}`);
    await b.shot(`${OUT}/1-form-${w}.png`);
  }
  await b.width(390, 900);

  // 1. Email nhập lại khác → báo, không đặt đơn.
  await openBuy();
  await order("Khách Mua", phone, email, `khac${stamp}@x.vn`);
  check("email nhập lại khác → báo", await see("Hai lần nhập email chưa giống nhau", 10000));

  // 2. Đặt đơn: sang trang đơn /don-hang, có QR, chưa có tài khoản nào được tạo.
  await openBuy();
  await order("Khách Mua", phone, email);
  check("đặt xong → sang trang đơn", await waitFor(async () => (await path()).startsWith("/don-hang/ME"), 120000), await path());
  const code = (await path()).split("/").pop();
  check("trang đơn có QR và nhắc email nhận thông tin", (await see("Dùng app ngân hàng quét mã QR")) && (await text()).includes(`k•••@x.vn`));
  const { rows: [before] } = await db.query(`SELECT count(*)::int AS n FROM password_logins WHERE phone_canonical = $1`, [`+84${phone.slice(1)}`]);
  check("chưa trả tiền thì chưa có tài khoản", before.n === 0, String(before.n));
  await problems("trang đơn @390");
  await b.shot(`${OUT}/2-don-hang.png`);

  // 3. Trình duyệt khác (không cookie của đơn) không mở được trang đơn.
  const other = await openBrowser({ port: 9457 });
  try {
    await other.go(`${BASE}/don-hang/${code}`);
    await waitFor(async () => (await other.evaluate(`document.body.innerText`)).includes("Không mở được đơn này"), 60000);
    check("máy khác không mở được đơn", (await other.evaluate(`document.body.innerText`)).includes("Không mở được đơn này"));
  } finally {
    other.close();
  }

  // 4. Đặt lại khi đơn còn hạn → báo đang có đơn chờ (giữ cookie như người mua thật để quay lại trang đơn).
  await openBuy(false);
  await order("Khách Mua", phone, email);
  check("số/email đang có đơn chờ → báo", await see("đang có đơn chờ thanh toán", 30000));

  // 5. Tiền về → tài khoản tạo, trang đơn báo đang gửi email, không có mật khẩu.
  await b.go(`${BASE}/don-hang/${code}`);
  await see("Dùng app ngân hàng quét mã QR");
  const { rows: [o] } = await db.query(`SELECT amount_due_vnd FROM orders WHERE code = $1`, [code]);
  check("webhook nhận tiền 200", (await webhook(code, o.amount_due_vnd)) === 200);
  check("trang đơn: thanh toán thành công", await see("Thanh toán thành công", 60000));
  check("trang đơn báo gửi thông tin tới email (che bớt)", (await text()).includes("k•••@x.vn") && (await text()).includes("thông tin đăng nhập"));
  check("trang đơn không hiện mật khẩu", !(await text()).includes("Mật khẩu tạm"));
  const { rows: [acc] } = await db.query(
    `SELECT p.must_change, c.email, (SELECT count(*)::int FROM outbox_events e WHERE e.dedup_key = 'order_paid:' || o.id || ':email') AS mails
     FROM orders o JOIN password_logins p ON p.user_id = o.user_id JOIN learner_contact_emails c ON c.user_id = o.user_id WHERE o.code = $1`, [code]);
  check("tài khoản tạo khi nhận tiền: mật khẩu tạm, email liên hệ, một thư chờ gửi", acc?.must_change === true && acc?.email === email && acc?.mails === 1, JSON.stringify(acc));
  await problems("đã thanh toán @390");
  await b.shot(`${OUT}/3-da-thanh-toan.png`);

  // 6. Số / email đã có tài khoản → báo trùng, mời đăng nhập.
  await openBuy();
  await order("Ai Đó", phone, `moi${stamp}@x.vn`);
  check("số đã có tài khoản → báo trùng", await see("Số điện thoại này đã có tài khoản", 30000));
  check("có Đăng nhập để mua trỏ đúng next", await b.evaluate(`[...document.querySelectorAll("main a")].some((a) => a.textContent.trim() === "Đăng nhập để mua" && a.getAttribute("href") === ${JSON.stringify(`/dang-nhap?next=${encodeURIComponent(`/mua/${SLUG}`)}`)})`));
  await b.shot(`${OUT}/4-trung-so.png`);
  await openBuy();
  await order("Ai Đó", `094${stamp}`, email);
  check("email đã có tài khoản → báo trùng", await see("Email này đã có tài khoản", 30000));

  const errors = b.events.errors.filter((e) => !String(e).includes("401") && !String(e).includes("404"));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  b.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
