// Đăng ký / đăng nhập bằng số điện thoại + mật khẩu (D2) trên trình duyệt thật.
// node tests/e2e-ui/phone-login.mjs <địa chỉ gốc> <thư mục ảnh>
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser();
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const click = (label) => b.evaluate(`(() => { const el = [...document.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`);
// Điền theo nhãn của ô (label bọc input/select).
const fill = (label, value) => b.evaluate(`(() => {
  const field = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === ${JSON.stringify(label)});
  const el = field?.querySelector("input,select");
  if (!el) return false;
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
})()`);
// Nút gửi form (không phải nút thẻ cùng tên).
const submit = (label) => b.evaluate(`(() => { const el = [...document.querySelectorAll("form button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && e.type !== "button"); if (!el) return false; el.click(); return true; })()`);
// Đợi form xong việc (nút gửi hết bị khóa) trước lần gửi sau.
const idle = () => waitFor(() => b.evaluate(`[...document.querySelectorAll("form button")].every((e) => !e.disabled)`));
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("form input, form button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 40000);
const problems = async (where) => { const list = await b.evaluate(PAGE_CHECKS); check(`không lỗi giao diện: ${where}`, list.length === 0, JSON.stringify(list)); };
const openLogin = async () => { await b.go(`${BASE}/dang-nhap`); await hydrated(); };

// Số ngẫu nhiên mỗi lần chạy (đầu 09), mật khẩu đủ dài.
const phone = `09${String(Date.now()).slice(-8)}`;
const PW = "Thuyen vien 2026";

try {
  await b.width(360);
  await openLogin();
  check("mặc định thẻ số điện thoại", (await text()).includes("Số điện thoại") && await b.evaluate(`document.querySelector("input[type=tel]") !== null`));
  await problems("đăng nhập @360");
  await b.shot(`${OUT}/dang-nhap-so-360.png`);

  // 0. Mất mạng giữa chừng: báo lỗi kết nối, form không kẹt, có mạng lại thì gửi được.
  await fill("Số điện thoại", "0912345678");
  await fill("Mật khẩu", "mat khau bat ky");
  await b.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await submit("Đăng nhập");
  check("mất mạng: báo lỗi kết nối", await waitFor(async () => (await text()).includes("Không kết nối được")));
  check("mất mạng: nút gửi bấm lại được", await idle());
  await b.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // 1. Tạo tài khoản; mật khẩu yếu bị báo trước.
  await click("Tạo tài khoản");
  await waitFor(async () => (await text()).includes("Tên hiển thị"));
  await fill("Tên hiển thị", "Thợ máy thử");
  await fill("Số điện thoại", phone);
  await fill("Mật khẩu", "1234");
  await submit("Tạo tài khoản");
  check("mật khẩu ngắn bị báo", await waitFor(async () => (await text()).includes("Mật khẩu cần ít nhất 8 ký tự")));
  await fill("Mật khẩu", PW);
  await submit("Tạo tài khoản");
  const leftLogin = () => waitFor(async () => (await b.evaluate("location.pathname")) !== "/dang-nhap", 60000);
  check("tạo tài khoản xong, vào thẳng trang đích", await leftLogin(), (await text()).slice(0, 300));
  await b.shot(`${OUT}/dang-ky-xong-360.png`);

  // 2. Bỏ phiên (xóa cookie) rồi đăng nhập lại bằng số dạng khác.
  await b.send("Network.clearBrowserCookies");
  await openLogin();
  await fill("Số điện thoại", `+84 ${phone.slice(1)}`);
  await fill("Mật khẩu", PW);
  await submit("Đăng nhập");
  check("đăng nhập lại bằng số dạng +84", await leftLogin(), (await text()).slice(0, 300));

  // 3. Sai 5 lần → báo khóa.
  await b.send("Network.clearBrowserCookies");
  await openLogin();
  await fill("Số điện thoại", phone);
  for (let i = 0; i < 5; i++) {
    await fill("Mật khẩu", `sai mat khau ${i}`);
    await idle();
    await submit("Đăng nhập");
    await sleep(200);
    await idle();
  }
  check("báo sai mật khẩu", await waitFor(async () => (await text()).includes("Số điện thoại hoặc mật khẩu không đúng")), (await text()).slice(0, 400));
  await fill("Mật khẩu", PW);
  await submit("Đăng nhập");
  check("sai 5 lần thì khóa 15 phút", await waitFor(async () => (await text()).includes("Sai quá nhiều lần")));
  await b.shot(`${OUT}/khoa-360.png`);

  // 4. Quên mật khẩu: nói rõ cần email liên kết, trả lời như nhau.
  await click("Quên mật khẩu?");
  check("quên mật khẩu nêu cách lấy lại", await waitFor(async () => (await text()).includes("email đã liên kết")));
  await submit("Gửi mã đặt lại");
  check("gửi mã: trả lời trung tính", await waitFor(async () => (await text()).includes("Nếu số này có email liên kết")));
  await problems("quên mật khẩu @360");
  await b.shot(`${OUT}/quen-mat-khau-360.png`);

  const errors = b.events.errors.filter((e) => !String(e).includes("401"));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  b.close();
}
process.exit(failures.length ? 1 : 0);
