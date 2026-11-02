// Vận hành thật trên giao diện quản trị. node tests/e2e-ui/admin.mjs <địa chỉ gốc> <mã khóa> <thư mục ảnh>
// Cần MIGRATOR_DATABASE_URL (tạo tài khoản chủ thử), SEPAY_*; máy chủ chạy bản dev để lấy thư từ hộp thư giả.
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9445 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const click = async (label) => { const ok = await waitFor(() => b.evaluate(`(() => { const scope = document.querySelector("dialog[open]") ?? document; const el = [...scope.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); if (!el) return false; el.click(); return true; })()`), 10000); if (!ok) check(`bấm được “${label}”`, false); return ok; };
const fill = (label, value) => b.evaluate(`(() => {
  const scope = document.querySelector("dialog[open]") ?? document;
  const field = [...scope.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
  const el = field?.querySelector("input,textarea,select");
  if (!el) throw new Error("không có ô " + ${JSON.stringify(label)} + " · hộp mở: " + document.querySelectorAll("dialog[open]").length + " · " + (document.querySelector("dialog[open]")?.innerHTML ?? "").slice(0, 300));
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : el.tagName === "SELECT" ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
})()`);
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 30000);
const open = async (path) => { await b.go(BASE + path); await hydrated(); await waitFor(async () => !(await text()).includes("Đang tải…"), 15000); };

async function webhook(content, amount) {
  const vn = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const body = JSON.stringify({ id: Date.now() + Math.floor(Math.random() * 1000), gateway: process.env.SEPAY_BANK_CODE, accountNumber: process.env.SEPAY_ACCOUNT_NO, transferType: "in", transferAmount: amount, content, referenceCode: `FT${Date.now()}${Math.floor(Math.random() * 1000)}`, transactionDate: vn });
  const ts = String(Math.floor(Date.now() / 1000));
  const secret = process.env.SEPAY_WEBHOOK_SECRETS.split(",")[0].split(":").slice(1).join(":");
  const res = await fetch(`${BASE}/api/payments/sepay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-sepay-timestamp": ts, "x-sepay-signature": createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex") }, body });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function adminLogin(email) {
  await b.go(`${BASE}/admin/dang-nhap`);
  await hydrated();
  await b.evaluate(`fetch("/api/auth/admin/link/send", { method: "POST", headers: { "content-type": "application/json", origin: location.origin }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) })`);
  await sleep(500);
  const inbox = await b.evaluate(`fetch("/dev/thu").then((r) => r.text())`);
  const start = inbox.lastIndexOf(email);
  const link = inbox.slice(start).match(/href="([^"]+#link=[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!link) throw new Error("không thấy link đăng nhập");
  // Mở như bấm link từ email: tải trang mới, không chỉ đổi phần sau dấu #.
  await b.go("about:blank");
  await b.go(link);
  await hydrated();
  await click("Đăng nhập");
  await waitFor(async () => (await b.evaluate("location.pathname")) === "/admin");
  await hydrated();
}

const stamp = Date.now();
const ownerEmail = `chu${stamp}@x.vn`;
const supportEmail = `hotro${stamp}@x.vn`;
const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1, 'owner', 'active', now(), now() + interval '7 days', now())`, [ownerEmail]);

try {
  await b.width(1280);
  // Học viên có một đơn đang chờ để ghép tay.
  const learnerEmail = `hv${stamp}@x.vn`;
  await b.go(`${BASE}/khoa-hoc`);
  const orderCode = await b.evaluate(`(async () => {
    const h = { "content-type": "application/json" };
    await fetch("/api/auth/learner/otp/send", { method: "POST", headers: h, body: JSON.stringify({ contact: ${JSON.stringify(learnerEmail)}, displayName: "Học viên ${stamp}" }) });
    const inbox = await (await fetch("/dev/thu")).text();
    const code = inbox.slice(inbox.lastIndexOf(${JSON.stringify(learnerEmail)})).match(/\\b\\d{6}\\b/)[0];
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    await fetch("/api/auth/learner/otp/verify", { method: "POST", headers: h, body: JSON.stringify({ contact: ${JSON.stringify(learnerEmail)}, code, deviceKey, deviceLabel: "Máy thử", displayName: "Học viên ${stamp}" }) });
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner=")).split("=")[1];
    const r = await fetch("/api/me/orders", { method: "POST", headers: { ...h, "x-csrf-token": csrf }, body: JSON.stringify({ courseSlug: ${JSON.stringify(SLUG)}, acceptTerms: true }) });
    return (await r.json()).code;
  })()`);
  check("có đơn chờ", /^ME/.test(orderCode ?? ""), String(orderCode));
  const price = (await db.query(`SELECT amount_due_vnd FROM orders WHERE code = $1`, [orderCode])).rows[0].amount_due_vnd;
  await webhook("CHUYEN KHOAN KHONG CO MA", price);

  // Chủ
  await adminLogin(ownerEmail);
  check("chủ vào tổng quan", await see("Tiền đã nhận"));
  check("có cảnh báo khoản cần xử lý", await see("khoản cần xử lý tay"));
  check("menu có mục của chủ", (await text()).includes("Quản trị viên") && (await text()).includes("Job"));
  // FR-20: khoảng ngày tự chọn (ngày Việt Nam).
  await click("Tự chọn");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  await fill("Từ ngày", today);
  await fill("Đến ngày", today);
  check("khoảng tự chọn tải được số theo khóa", await waitFor(async () => {
    const t = await text();
    return t.includes("Theo khóa học") && !t.includes("không hợp lệ") && (await b.evaluate(`document.querySelector("input[type=date]")?.value`)) === today;
  }));
  for (const [path, marker] of [["/admin", "Tiền đã nhận"], ["/admin/so-giao-dich", "Cần xử lý tay"], ["/admin/hoan-tien", "Đề nghị hoàn tiền"], ["/admin/don-hang", orderCode], ["/admin/hoc-vien", "Tìm học viên"], ["/admin/khoa-hoc", SLUG], ["/admin/cap-khoa", "Tìm học viên"], ["/admin/gop-tai-khoan", "Tài khoản nguồn"], ["/admin/quan-tri-vien", ownerEmail], ["/admin/jobs", "me.orders.expire"]]) {
    for (const width of [360, 1280]) {
      await b.width(width);
      await open(path);
      check(`${path} @${width} có dữ liệu`, await see(marker), (await text()).slice(0, 200));
      const problems = await b.evaluate(PAGE_CHECKS);
      check(`${path} @${width} không lỗi giao diện`, problems.length === 0, JSON.stringify(problems));
      await b.shot(`${OUT}/${path.replace(/\W+/g, "-")}-${width}.png`);
    }
  }
  await b.width(1280);

  // Hộp xác nhận: Escape đóng, focus quay về nút.
  await open("/admin/so-giao-dich");
  await see("Ghép với đơn");
  await b.evaluate(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "Ghép với đơn").focus()`);
  await click("Ghép với đơn");
  check("mở hộp xác nhận có số tiền", await waitFor(() => b.evaluate(`document.querySelector("dialog[open]")?.innerText.includes("Ghép") ?? false`)));
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  check("Escape đóng hộp", await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") === null`), 3000));
  check("focus về nút đã mở", await b.evaluate(`document.activeElement?.textContent?.trim() === "Ghép với đơn"`));

  // Ghép tay khoản không có mã với đơn.
  await click("Ghép với đơn");
  check("mở lại được hộp sau khi đã đóng", await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") !== null`), 5000),
    await b.evaluate(`JSON.stringify([...document.querySelectorAll("dialog")].map((d) => [d.open, d.innerHTML.length]))`));
  await fill("Mã đơn", "MEZZZZZZZZ");
  await fill("Ghi chú", "thử");
  await fill("Bằng chứng", "ảnh sao kê");
  await click("Ghép với đơn");
  check("mã đơn sai → báo lỗi trong hộp, không đóng", await waitFor(() => b.evaluate(`document.querySelector("dialog[open] [role=alert]") !== null`)));
  await fill("Mã đơn", orderCode);
  await click("Ghép với đơn");
  check("ghép xong báo kết quả", await see("đơn chuyển sang đã thanh toán"), (await text()).slice(0, 300));
  const paid = (await db.query(`SELECT status FROM orders WHERE code = $1`, [orderCode])).rows[0].status;
  check("đơn thật sự đã thanh toán", paid === "paid", paid);

  // Hoàn tiền: đề nghị → duyệt → chuyển → xác nhận.
  await open("/admin/hoan-tien");
  await click("Đề nghị hoàn tiền");
  await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") !== null`));
  await fill("Mã đơn", orderCode);
  await fill("Lý do", "thử hoàn");
  await fill("Ngân hàng", "Vietcombank");
  await fill("Số tài khoản", "0011223344");
  await fill("Tên chủ tài khoản", "NGUYEN VAN THU");
  await click("Gửi đề nghị");
  check("hiện tài khoản nhận", await see("Nhận: Vietcombank · 0011223344"));
  check("có yêu cầu hoàn", await see("thử hoàn"));
  await click("Duyệt"); await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") !== null`)); await click("Duyệt");
  check("đã duyệt", await see("Đã duyệt"));
  await click("Đã chuyển tiền"); await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") !== null`));
  await fill("Mã giao dịch chuyển trả", `OUT${stamp}`); await fill("Bằng chứng", "ảnh");
  await click("Đã chuyển tiền");
  await see("Đã chuyển");
  await click("Xác nhận");
  check("hộp xác nhận nêu thu hồi quyền học", await waitFor(() => b.evaluate(`document.querySelector("dialog[open]")?.innerText.includes("thu hồi quyền học") ?? false`)));
  await click("Xác nhận");
  check("đã xác nhận hoàn", await see("Đã xác nhận"));
  const revoked = async () => {
    const { rows } = await db.query(`SELECT o.status, e.revoked_at FROM orders o JOIN enrollments e ON e.order_id = o.id WHERE o.code = $1`, [orderCode]);
    return rows[0]?.status === "refunded" && rows[0]?.revoked_at !== null;
  };
  check("đơn hoàn và quyền học bị thu hồi", await waitFor(revoked, 5000));

  // Cấp không thu tiền.
  await open("/admin/cap-khoa");
  await fill("Tìm học viên", learnerEmail);
  await click("Tìm");
  await see("Chọn học viên này");
  await click("Chọn học viên này");
  await see("Khóa *");
  const courseId = (await db.query(`SELECT id FROM courses WHERE slug = $1`, [SLUG])).rows[0].id;
  await fill("Khóa", courseId);
  await sleep(200);
  await click("Cấp khóa");
  await waitFor(() => b.evaluate(`document.querySelector("dialog[open]") !== null`));
  await fill("Lý do", "quà tặng thử");
  await click("Cấp khóa");
  check("đã cấp", await see("Đã cấp"));

  // Mời hỗ trợ.
  await open("/admin/quan-tri-vien");
  await fill("Email", supportEmail);
  await click("Gửi lời mời");
  check("có lời mời", await see(supportEmail));
  await click("Đăng xuất");
  await waitFor(async () => (await b.evaluate("location.pathname")) === "/admin/dang-nhap");

  // Hỗ trợ: không thấy mục của chủ, mở trực tiếp vẫn bị chặn.
  await adminLogin(supportEmail);
  check("hỗ trợ vào tổng quan", await see("Tiền đã nhận"));
  const nav = await text();
  check("menu không có mục của chủ", !nav.includes("Quản trị viên") && !nav.includes("Cấp không thu tiền") && !nav.includes("Gộp tài khoản"));
  await open("/admin/quan-tri-vien");
  check("mở thẳng trang của chủ → không có quyền", await see("không có quyền"), (await text()).slice(0, 200));
  await open("/admin/jobs");
  check("mở thẳng Job → không có quyền", await see("không có quyền"));
  await open("/admin/hoc-vien");
  await b.width(390);
  await sleep(300);
  check("điện thoại không tràn", (await b.evaluate(PAGE_CHECKS)).length === 0);
  await b.shot(`${OUT}/ho-tro-hoc-vien-390.png`);
  const errors = b.events.errors.filter((e) => !/40[134]/.test(String(e)));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)).slice(0, 400));
} finally {
  await db.end();
  b.close();
}
console.log(failures.length ? `HỎNG ${failures.length}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
