// Nút “Tải app” (cài web app học lên điện thoại): node tests/e2e-ui/install.mjs <địa chỉ gốc> <thư mục ảnh>
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser();
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const hydratedButton = () => waitFor(() => b.evaluate(`(() => { const el = [...document.querySelectorAll("header button")].find((e) => e.textContent.trim() === "Tải app"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 60000);
const clickInstall = () => b.evaluate(`[...document.querySelectorAll("header button")].find((e) => e.textContent.trim() === "Tải app").click()`);
const dialogText = () => b.evaluate(`document.querySelector("dialog[open]")?.innerText ?? ""`);
const asDevice = async (userAgent) => { await b.send("Emulation.setUserAgentOverride", { userAgent }); await b.go(`${BASE}/`); return hydratedButton(); };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const ZALO = `${ANDROID} Zalo android/12100`;

// Chặn sự kiện “cài được” thật của Chrome (headless có thể phát) để kiểm đường hướng dẫn; đường hộp thoại cài kiểm riêng ở cuối.
const BLOCK = `addEventListener("beforeinstallprompt", (e) => { if (!e.fake) e.stopImmediatePropagation(); }, true);`;

try {
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: BLOCK });
  await b.width(360);
  // Manifest và icon để Android cài được.
  await b.go(`${BASE}/`);
  await hydratedButton();
  const manifest = await b.evaluate(`fetch("/manifest.webmanifest").then((r) => r.json())`);
  check("manifest có icon PNG 192 và 512, mở vào /hoc", manifest.start_url === "/hoc" && ["192x192", "512x512"].every((s) => manifest.icons.some((i) => i.sizes === s && i.type === "image/png")));
  const icon = await b.evaluate(`fetch("/icon-192.png").then((r) => r.status + " " + r.headers.get("content-type"))`);
  check("icon 192 tải được", icon === "200 image/png", icon);
  check("có apple-touch-icon cho iPhone", await b.evaluate(`document.querySelector("link[rel='apple-touch-icon']")?.getAttribute("href") === "/apple-touch-icon.png"`));

  // iPhone: hướng dẫn Safari, không có bước Android.
  check("iPhone: header có nút Tải app", await asDevice(IPHONE));
  check("không lỗi giao diện @360", (await b.evaluate(PAGE_CHECKS)).length === 0, JSON.stringify(await b.evaluate(PAGE_CHECKS)));
  await clickInstall();
  check("iPhone: hiện hướng dẫn Thêm vào MH chính", await waitFor(async () => (await dialogText()).includes("Thêm vào MH chính")));
  check("iPhone: không hiện bước Android", !(await dialogText()).includes("Android (Chrome)"));
  await b.shot(`${OUT}/tai-app-iphone-360.png`);
  await b.evaluate(`document.querySelector("dialog[open] form button").click()`);
  check("đóng được hướng dẫn", await waitFor(async () => (await dialogText()) === ""));

  // Android không có hộp thoại cài của trình duyệt (headless): hiện hướng dẫn Chrome.
  check("Android: header có nút Tải app", await asDevice(ANDROID));
  await clickInstall();
  check("Android: hiện hướng dẫn Cài đặt ứng dụng", await waitFor(async () => (await dialogText()).includes("Cài đặt ứng dụng")));
  check("Android: không hiện bước iPhone", !(await dialogText()).includes("iPhone (Safari)"));

  // Mở trong Zalo: nhắc mở bằng trình duyệt trước.
  check("Zalo: header có nút Tải app", await asDevice(ZALO));
  await clickInstall();
  check("Zalo: nhắc mở bằng trình duyệt", await waitFor(async () => (await dialogText()).includes("Mở bằng trình duyệt")));
  await b.shot(`${OUT}/tai-app-zalo-360.png`);

  // Android có hộp thoại cài của trình duyệt: bấm nút thì gọi hộp thoại đó; đồng ý cài thì nút ẩn.
  check("Android có hộp thoại cài: header có nút", await asDevice(ANDROID));
  await b.evaluate(`(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.fake = true;
    e.prompt = async () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    dispatchEvent(e);
  })()`);
  // React cập nhật trạng thái "có hộp thoại cài" sau sự kiện; máy chậm thì chờ một nhịp trước khi bấm.
  await sleep(1000);
  await clickInstall();
  check("gọi hộp thoại cài của trình duyệt", await waitFor(() => b.evaluate("window.__prompted === true")));
  check("đồng ý cài thì ẩn nút", await waitFor(async () => !(await text()).includes("Tải app")));
  check("không mở hướng dẫn khi có hộp thoại cài", (await dialogText()) === "");

  // Đã mở dạng app (đã cài): không hiện nút.
  // Chrome headless không giả lập được display-mode: kiểm qua dấu hiệu của iPhone (navigator.standalone), code đọc cả hai.
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, "standalone", { get: () => true });` });
  await b.send("Emulation.setUserAgentOverride", { userAgent: IPHONE });
  await b.go(`${BASE}/`);
  await waitFor(() => b.evaluate(`Object.keys(document.querySelector("header a") ?? {}).some((k) => k.startsWith("__reactProps"))`), 60000);
  await sleep(500);
  check("đã cài (standalone): ẩn nút Tải app", !(await text()).includes("Tải app"));

  const errors = b.events.errors.filter((e) => !String(e).includes("401"));
  check("không lỗi trang", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  b.close();
}
process.exit(failures.length ? 1 : 0);
