// Drive headless Chrome over CDP to capture click-only UI states.
// Usage: node shoot.mjs <outDir>   (Chrome must listen on 127.0.0.1:9222, preview server on :5173)
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

// Helpers injected into the page. Elements are re-created on every setState, so always re-query.
const HELPERS = `
window.__q = {
  byText(t) {
    const all = [...document.querySelectorAll('body *')].filter((e) => e.textContent.trim() === t && e.offsetParent !== null);
    return all.filter((e) => ![...e.children].some((c) => all.includes(c)))[0] || null;
  },
  click(t) { const e = this.byText(t); if (!e) throw new Error('no element with text: ' + t); e.click(); return true; },
  clickNth(t, n) {
    const all = [...document.querySelectorAll('body *')].filter((e) => e.textContent.trim() === t && e.offsetParent !== null);
    const leaf = all.filter((e) => ![...e.children].some((c) => all.includes(c)));
    if (!leaf[n]) throw new Error('no element #' + n + ' with text: ' + t); leaf[n].click(); return true;
  },
  fill(sel, v) {
    const e = document.querySelector(sel); if (!e) throw new Error('no input: ' + sel);
    if (e.type === 'checkbox') { e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    if (e.localName === 'select') { e.value = v || e.options[1].value; e.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  },
};`;

async function evalPage(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function open(url, width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + url });
  await sleep(2500);
  await evalPage(HELPERS);
}

async function shot(name, width, skipX = 0) {
  await sleep(600);
  const h = await evalPage(`(() => {
    let max = 0;
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height && r.right > ${skipX}) max = Math.max(max, r.bottom + window.scrollY);
    }
    return Math.ceil(max);
  })()`);
  const height = Math.min(Math.max(h + 24, 600), 8000);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('saved', name, width + 'x' + height);
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
}

const q = (js) => evalPage(`window.__q.${js}`);
const scenarios = [
  ['Checkout__thanh-cong', 'Checkout.dc.html', 1440, async () => q(`click('Thành công')`)],
  ['Checkout__het-han', 'Checkout.dc.html', 1440, async () => q(`click('Hết hạn')`)],
  ['Checkout__ma-giam-gia', 'Checkout.dc.html', 1440, async () => {
    await q(`fill('input[placeholder]', 'EARLY100')`); await q(`click('Áp dụng')`);
  }],
  ['Login__tab-dang-nhap', 'Login.dc.html', 1440, async () => q(`click('Đăng nhập')`)],
  ['Login__loi-bo-trong', 'Login.dc.html', 1440, async () => q(`click('Tạo tài khoản')`).then(() => q(`clickNth('Tạo tài khoản', 1)`).catch(() => true))],
  ['Login__nhap-ma', 'Login.dc.html', 1440, async () => {
    await q(`fill('#f-name', 'Nguyễn Văn Minh')`); await q(`fill('#f-contact', '0912345678')`); await q(`fill('#f-rank', '')`);
    await q(`clickNth('Tạo tài khoản', 1)`);
  }],
  ['Login__xong', 'Login.dc.html', 1440, async () => {
    await q(`fill('#f-name', 'Nguyễn Văn Minh')`); await q(`fill('#f-contact', '0912345678')`); await q(`fill('#f-rank', '')`);
    await q(`clickNth('Tạo tài khoản', 1)`); await sleep(400);
    await q(`fill('input[aria-label="Mã xác minh 6 chữ số"]', '123456')`);
    await evalPage(`[...document.querySelectorAll('button')].find(b => /Xác minh|Xác nhận|Tiếp tục/.test(b.textContent)).click()`);
  }],
  ['BuyerInfo__kiem-tra-lai', 'BuyerInfo.dc.html', 1440, async () => {
    await q(`fill('#b-name', 'Nguyễn Văn Minh')`); await q(`fill('#b-phone', '0912345678')`); await q(`fill('#b-rank', '')`);
    await evalPage(`(() => { const c = document.querySelectorAll('input[type=checkbox]')[0]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await q(`click('Tiếp tục thanh toán')`);
  }],
  ['BuyerInfo__loi-bo-trong', 'BuyerInfo.dc.html', 1440, async () => q(`click('Tiếp tục thanh toán')`)],
  ['Mobile__cap-khoa', 'Mobile.dc.html', 390, async () => q(`clickNth('Cấp khóa', 0)`)],
  ['Policies__hoan-tien', 'Policies.dc.html', 1440, async () => q(`click('Hoàn tiền')`)],
  ['Policies__dieu-khoan', 'Policies.dc.html', 1440, async () => q(`click('Điều khoản')`)],
  ['Account__xac-nhan-xoa', 'Account.dc.html', 1440, async () => q(`click('Yêu cầu xóa tài khoản')`)],
  ['Catalog__phong-van', 'Catalog.dc.html', 1440, async () => q(`click('Phỏng vấn')`)],
  ['CadetLesson__developing-da-thu', 'CadetLesson.dc.html?startLevel=developing', 390, async () => q(`click('Tôi đã thử nói')`)],
  ['CadetCourse__chu-de-a1', 'CadetCourse.dc.html', 390, async () => {
    await evalPage(`[...document.querySelectorAll('body *')].filter(e => /^A1/.test(e.textContent.trim()) && e.offsetParent).pop().click()`);
  }],
];

const only = process.argv[3];
const failed = [];
for (const [name, url, width, act] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  try {
    await open(url, width);
    await act();
    await shot(name, width, url.startsWith('Main') || url.startsWith('Content') ? 300 : 0);
  } catch (e) {
    failed.push(name + ': ' + e.message);
    console.log('FAILED', name, e.message);
  }
}
console.log('done; failed:', failed.length);
ws.close();
