// Dùng bàn phím trên trang mua và thanh toán; và nhánh quay lại trang mua sau đăng nhập Google (phần trong trình duyệt).
// node tests/e2e-ui/keyboard.mjs <địa chỉ gốc> <mã khóa> <thư mục ảnh>; máy chủ dev (hộp thư giả), cấu hình CHECKOUT_* đủ.
import { mkdirSync } from "node:fs";
import { openBrowser } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9447 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const key = async (k, code = k, vk = 0) => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k === " " ? { text: " " } : k === "Enter" ? { text: "\r" } : {}) });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};
const tab = () => key("Tab", "Tab", 9);
/** Phần tử đang có focus: tên, và viền focus có hiện không. */
const focused = () => b.evaluate(`(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  const name = (el.getAttribute("aria-label") || el.innerText || el.value || el.type || el.tagName).trim().slice(0, 40);
  return { name, tag: el.tagName, visible: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 };
})()`);
async function tabUntil(match, max = 40) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    await tab();
    const f = await focused();
    if (!f) continue;
    seen.push(f);
    if (match(f)) return { found: f, seen };
  }
  return { found: null, seen };
}
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("main button, main a"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 30000);

try {
  await b.width(390);
  // Đăng nhập học viên mới bằng API (luồng giao diện đã kiểm ở purchase.mjs).
  const email = `phim${Date.now()}@x.vn`;
  await b.go(`${BASE}/khoa-hoc`);
  await b.evaluate(`(async () => {
    const h = { "content-type": "application/json" };
    await fetch("/api/auth/learner/otp/send", { method: "POST", headers: h, body: JSON.stringify({ contact: ${JSON.stringify(email)}, displayName: "Bàn phím" }) });
    const inbox = await (await fetch("/dev/thu")).text();
    const code = inbox.slice(inbox.lastIndexOf(${JSON.stringify(email)})).match(/\\b\\d{6}\\b/)[0];
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const deviceKey = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const r = await fetch("/api/auth/learner/otp/verify", { method: "POST", headers: h, body: JSON.stringify({ contact: ${JSON.stringify(email)}, code, deviceKey, deviceLabel: "Bàn phím", displayName: "Bàn phím" }) });
    return (await r.json()).next;
  })()`).then((next) => check("đăng nhập thử", next === "done", String(next)));

  // Nhánh Google: trang đăng nhập lưu đích trước khi rời sang Google; Google trả về /hoc, app học chuyển tiếp.
  await b.evaluate(`sessionStorage.setItem("me.login.next", "/mua/${SLUG}")`);
  await b.go(`${BASE}/hoc`);
  check("về /hoc sau Google → chuyển sang đúng trang mua", await waitFor(async () => (await b.evaluate("location.pathname")) === `/mua/${SLUG}`));
  check("đích đã dùng thì bị xóa", (await b.evaluate(`sessionStorage.getItem("me.login.next")`)) === null);
  await b.evaluate(`sessionStorage.setItem("me.login.next", "/\\t/evil.com")`);
  await b.go(`${BASE}/hoc`);
  await sleep(2500);
  check("đích độc hại bị bỏ qua", (await b.evaluate("location.origin + location.pathname")) === `${BASE}/hoc`);

  // Trang mua chỉ bằng bàn phím.
  await b.go(`${BASE}/mua/${SLUG}`);
  await hydrated();
  await waitFor(() => b.evaluate(`document.querySelector("input[type=checkbox]") !== null`));
  const toBox = await tabUntil((f) => f.tag === "INPUT");
  check("Tab tới được ô đồng ý", Boolean(toBox.found), JSON.stringify(toBox.seen.map((f) => f.name)));
  check("mọi chỗ dừng có viền focus", toBox.seen.every((f) => f.visible), JSON.stringify(toBox.seen.filter((f) => !f.visible)));
  const order = toBox.seen.map((f) => f.name);
  check("menu trên cùng đi trước nội dung", order.indexOf("Marine English") !== -1 && order.indexOf("Marine English") < order.length - 1, JSON.stringify(order));
  await key(" ", "Space", 32);
  check("Space tích ô đồng ý", await b.evaluate(`document.querySelector("input[type=checkbox]").checked`));
  const toBuy = await tabUntil((f) => f.name.includes("Tiếp tục thanh toán"), 10);
  check("Tab tiếp tới nút Tiếp tục thanh toán", Boolean(toBuy.found), JSON.stringify(toBuy.seen.map((f) => f.name)));
  await key("Enter", "Enter", 13);
  check("Enter sang trang thanh toán", await waitFor(async () => (await b.evaluate("location.pathname")).startsWith("/thanh-toan/ME")));

  // Trang thanh toán: các nút chép tới được bằng Tab, có viền focus.
  await waitFor(() => b.evaluate(`document.body.innerText.includes("Thông tin chuyển khoản")`));
  await hydrated();
  const copies = [];
  for (let i = 0; i < 40 && copies.length < 3; i++) {
    await tab();
    const f = await focused();
    if (f?.name.startsWith("Chép")) copies.push(f);
  }
  check("Tab tới đủ 3 nút chép", copies.length === 3, JSON.stringify(copies));
  check("nút chép có viền focus", copies.every((f) => f.visible));
  await b.shot(`${OUT}/thanh-toan-focus.png`);
} finally {
  b.close();
}
console.log(failures.length ? `HỎNG ${failures.length}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
