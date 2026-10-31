// Điều khiển Chrome không giao diện qua cổng gỡ lỗi; không cần thư viện ngoài.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser({ port = 9444 } = {}) {
  if (await fetch(`http://127.0.0.1:${port}/json`).then(() => true, () => false)) throw new Error(`Cổng ${port} đang bị Chrome khác giữ`);
  const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "me-ui-"))}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 40 && !targets.some((t) => t.type === "page"); i++) {
    await sleep(250);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json(), () => []);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const events = { errors: [], requests: [] };
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") events.errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") events.errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Network.requestWillBeSent") events.requests.push(d.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  return {
    send, evaluate, events,
    async width(w, h = 900) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 }); },
    async go(url) {
      await send("Page.navigate", { url });
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        if ((await evaluate("document.readyState")) === "complete") break;
      }
      await sleep(400);
    },
    async shot(path) {
      const { writeFileSync } = await import("node:fs");
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(path, Buffer.from(r.result.data, "base64"));
    },
    close() { ws.close(); chrome.kill(); },
  };
}

/** Lỗi giao diện kiểm được tự động trên trang đang mở (spec mục 3). */
export const PAGE_CHECKS = `(() => {
  const problems = [];
  if (document.documentElement.scrollWidth > innerWidth) problems.push("tràn ngang " + document.documentElement.scrollWidth + ">" + innerWidth);
  for (const el of document.querySelectorAll("input:not([type=hidden]),select,textarea")) {
    if (!el.labels?.length && !el.getAttribute("aria-label")) problems.push("ô nhập không có nhãn: " + (el.name || el.type));
  }
  for (const b of document.querySelectorAll("button,a")) {
    if (!b.textContent.trim() && !b.getAttribute("aria-label")) problems.push("nút không có tên: " + b.outerHTML.slice(0, 80));
  }
  for (const word of ["payOS", "điền sẵn", "[chờ", "Dữ liệu mẫu", "ME-10", "Create Next App"]) {
    if (document.body.innerText.includes(word)) problems.push("còn chữ cấm: " + word);
  }
  return problems;
})()`;
