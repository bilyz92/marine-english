// Mua khóa không cần đăng nhập trước (docs/superpowers/plans/2026-11-05-guest-checkout.md, Task 3).
// node tests/e2e-ui/guest-checkout.mjs <địa chỉ gốc> <mã khóa đang bán> <thư mục ảnh>
// Máy chủ: đủ cấu hình nhận tiền. Cần MIGRATOR_DATABASE_URL (tạo dữ liệu thử) và quyền chạy `pnpm cli admin:login-link`.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
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
const signOut = () => b.send("Network.clearBrowserCookies");
const problems = async (where) => { const list = await b.evaluate(PAGE_CHECKS); check(`không lỗi giao diện: ${where}`, list.length === 0, JSON.stringify(list)); };
const openBuy = async () => { await b.go(`${BASE}/mua/${SLUG}`); await see("Tạo tài khoản và tiếp tục"); await hydrated(); };

const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
const stamp = String(Date.now()).slice(-7);
const phone = `093${stamp}`;

try {
  for (const w of [390, 1280]) {
    await b.width(w, 900);
    await openBuy();
    check(`khách mở trang mua thấy form (${w})`, (await path()) === `/mua/${SLUG}`);
    await problems(`form khách @${w}`);
    await b.shot(`${OUT}/1-form-${w}.png`);
  }
  await b.width(390, 900);

  // 1. Khách mới: chưa tích điều khoản → báo; tích → tạo tài khoản và sang thanh toán ngay, KHÔNG hiện mật khẩu (chủ 09/11/2026).
  await fill("Họ và tên *", "Khách Mua Nhanh");
  await fill("Số điện thoại *", phone);
  await fill("Email (không bắt buộc)", `khach${stamp}@x.vn`);
  await waitFor(() => fill("Nhập lại email", `khach${stamp}@x.vn`), 10000);
  await press("Tạo tài khoản và tiếp tục");
  check("chưa đồng ý điều khoản → báo", await see("Cần đồng ý điều khoản", 10000));
  await tick("Tôi đồng ý");
  await press("Tạo tài khoản và tiếp tục");
  check("tạo xong → sang trang thanh toán ngay", await waitFor(async () => (await path()).startsWith("/thanh-toan/ME"), 120000));
  const firstOrder = (await path()).split("/").pop();
  await see("Tôi đã chuyển khoản");
  check("bước 2 không hiện mật khẩu", !(await text()).includes("Mật khẩu tạm"));

  // 3. Bước 3: báo đã chuyển khoản → hiện tài khoản (số + mật khẩu tạm), nhắc email.
  await waitFor(() => b.evaluate(`(() => { const e = [...document.querySelectorAll("main button")].find((x) => x.textContent.trim() === "Tôi đã chuyển khoản" && Object.keys(x).some((k) => k.startsWith("__reactProps"))); e?.click(); return !!e; })()`), 60000);
  check("bước 3 hiện Tài khoản của bạn", await see("Tài khoản của bạn"));
  const password = await b.evaluate(`[...document.querySelectorAll('[aria-label="Tài khoản của bạn"] dd')][1]?.textContent.trim()`);
  check("bước 3 có số điện thoại và mật khẩu tạm 10 ký tự", (await text()).includes(phone) && /^[A-Za-z0-9]{10}$/.test(password ?? ""), String(password));
  check("bước 3 nhắc sẽ gửi email khi thanh toán xong, hiện đúng email nhận thư", (await text()).includes("gửi vào email") && (await text()).includes(`khach${stamp}@x.vn`));
  await problems("bước 3 @390");
  await b.shot(`${OUT}/2-buoc-3.png`);

  // 2. Số đã có tài khoản: sai mật khẩu → báo; mật khẩu tạm → phải đặt mật khẩu mới ngay trên trang mua.
  await signOut();
  await openBuy();
  await fill("Họ và tên *", "Ai Đó");
  await fill("Số điện thoại *", phone);
  await tick("Tôi đồng ý");
  await press("Tạo tài khoản và tiếp tục");
  check("số trùng → hỏi mật khẩu", await see("đã có tài khoản. Nhập mật khẩu"));
  check("có nút Đăng nhập cách khác trỏ đúng next", await b.evaluate(`[...document.querySelectorAll("main a")].some((a) => a.textContent.trim() === "Đăng nhập cách khác" && a.getAttribute("href") === ${JSON.stringify(`/dang-nhap?next=${encodeURIComponent(`/mua/${SLUG}`)}`)})`));
  await fill("Mật khẩu", "sai-mat-khau-1");
  await tick("Tôi đồng ý");
  await press("Đăng nhập và mua tiếp");
  check("sai mật khẩu → báo", await see("Số điện thoại hoặc mật khẩu không đúng"));
  await fill("Mật khẩu", password);
  await press("Đăng nhập và mua tiếp");
  check("lần đầu đăng nhập bằng mật khẩu tạm → bắt đặt mật khẩu mới", await see("Đặt mật khẩu mới để mua tiếp"));
  await fill("Mật khẩu mới (ít nhất 8 ký tự)", "Thuyenvien2026moi");
  await press("Đăng nhập và mua tiếp");
  check("đặt xong → về đơn cũ hoặc báo đã có khóa (đang mở tạm)", await waitFor(async () => (await path()) === `/thanh-toan/${firstOrder}` || (await text()).includes("Bạn đã có khóa"), 60000), await path());
  const { rows: orders } = await db.query(`SELECT count(*)::int AS n FROM orders o JOIN password_logins p ON p.user_id = o.user_id WHERE p.phone_canonical = $1`, [`+84${phone.slice(1)}`]);
  check("chỉ một đơn", orders[0].n === 1, String(orders[0].n));

  // 3. Email trùng tài khoản đã có → báo, nút đăng nhập trỏ đúng next.
  const takenEmail = `co${stamp}@x.vn`;
  const { rows: [u] } = await db.query(`INSERT INTO users (display_name) VALUES ('Có email') RETURNING id`);
  await db.query(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', $2, now())`, [u.id, takenEmail]);
  await signOut();
  await openBuy();
  await fill("Họ và tên *", "Người Có Email");
  await fill("Số điện thoại *", `094${stamp}`);
  await fill("Email (không bắt buộc)", takenEmail);
  await waitFor(() => fill("Nhập lại email", takenEmail), 10000);
  await tick("Tôi đồng ý");
  await press("Tạo tài khoản và tiếp tục");
  check("email trùng → báo đã có tài khoản", await see("Email này đã có tài khoản"));
  check("có Liên hệ hỗ trợ", (await text()).includes("Liên hệ hỗ trợ"));

  // 4. Số đã xác minh nhưng không có mật khẩu → chủ đặt mật khẩu tạm → khách đặt mật khẩu mới ngay trên trang mua → thanh toán.
  const zaloPhone = `096${stamp}`;
  const { rows: [z] } = await db.query(`INSERT INTO users (display_name) VALUES ('Có Zalo') RETURNING id`);
  await db.query(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'phone', $2, now())`, [z.id, `+84${zaloPhone.slice(1)}`]);
  await signOut();
  await openBuy();
  await fill("Họ và tên *", "Có Zalo");
  await fill("Số điện thoại *", zaloPhone);
  await tick("Tôi đồng ý");
  await press("Tạo tài khoản và tiếp tục");
  check("số đã xác minh → hỏi mật khẩu, có Liên hệ hỗ trợ", (await see("đã có tài khoản. Nhập mật khẩu")) && (await text()).includes("Liên hệ hỗ trợ"));
  const adminEmail = `chu-mua${stamp}@x.vn`;
  await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1,'owner','active',now(),now()+interval '7 days',now())`, [adminEmail]);
  const link = execSync(`pnpm -s cli admin:login-link ${adminEmail}`, { encoding: "utf8", env: process.env }).match(/http\S+#link=\S+/)?.[0];
  const admin = await openBrowser({ port: 9456 });
  let temp = null;
  try {
    await admin.go(link);
    await waitFor(() => admin.evaluate(`(() => { const e=[...document.querySelectorAll("button")].find((x)=>x.textContent.trim()==="Vào trang quản trị"); e?.click(); return !!e; })()`), 60000);
    await waitFor(async () => (await admin.evaluate("location.pathname")) === "/admin", 60000);
    temp = await admin.evaluate(`(async () => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_admin=")).split("=")[1];
      const r = await fetch("/api/quan-tri/learners/${z.id}/password", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ reason: "Khách mua trên web, chưa có mật khẩu", evidence: "Gọi điện xác nhận số", phone: "${zaloPhone}" }) });
      return (await r.json()).temporaryPassword ?? null;
    })()`);
  } finally {
    admin.close();
  }
  check("chủ đặt được mật khẩu tạm", !!temp);
  await fill("Mật khẩu", temp ?? "");
  await press("Đăng nhập và mua tiếp");
  check("mật khẩu tạm → hỏi mật khẩu mới ngay trên trang mua", await see("Đặt mật khẩu mới để mua tiếp"));
  await fill("Mật khẩu mới (ít nhất 8 ký tự)", "Thuyenvien2026moi");
  await press("Đăng nhập và mua tiếp");
  check("đặt xong → sang trang thanh toán", await waitFor(async () => (await path()).startsWith("/thanh-toan/ME"), 120000), await path());

  await problems("trang thanh toán @390");
  const errors = b.events.errors.filter((e) => !String(e).includes("401"));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  b.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
