// Nút Nghe và bài không có đáp án trên trang học thử. node tests/e2e-ui/listen.mjs <địa chỉ gốc> <mã khóa có đáp án> <mã khóa từ Word> <thư mục ảnh>
// Hai khóa phải đang mở bán (trang học thử chỉ hiện khóa đang bán). speechSynthesis được giả lập để kiểm có/không có giọng cục bộ.
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, WITH_ANSWER, WORD, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9447 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 30000);
// Nút đọc có thể là "Nghe" hoặc "Nghe câu hỏi" (giao diện 3 mức).
const buttons = (label) => b.evaluate(`[...document.querySelectorAll("button")].filter((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).length`);

// Giả lập Web Speech: danh sách giọng theo kịch bản, ghi lại câu được đọc.
// delayMs > 0: như Chrome thật, lúc đầu chưa có giọng, sau đó mới báo "voiceschanged".
const stub = (voices, delayMs = 0) => `(() => {
  const all = ${JSON.stringify(voices)}.map((v) => ({ ...v, voiceURI: v.name, default: false }));
  let current = ${delayMs} > 0 ? [] : all;
  const handlers = new Set();
  const spoken = [];
  window.__spoken = spoken;
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => current, speak: (u) => { spoken.push({ text: u.text, voice: u.voice && u.voice.name }); setTimeout(() => u.onend && u.onend(), 50); },
    cancel: () => {}, addEventListener: (t, h) => { if (t === "voiceschanged") handlers.add(h); }, removeEventListener: (t, h) => handlers.delete(h),
  } });
  if (${delayMs} > 0) setTimeout(() => { current = all; for (const h of handlers) h(); }, ${delayMs});
})()`;

let scriptId = null;
async function withVoices(voices, delayMs = 0) {
  if (scriptId) await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = (await b.send("Page.addScriptToEvaluateOnNewDocument", { source: stub(voices, delayMs) })).result.identifier;
}

try {
  await b.width(390, 900);
  await withVoices([{ name: "Remote US", lang: "en-US", localService: false }, { name: "Daniel", lang: "en-GB", localService: true }, { name: "Linh", lang: "vi-VN", localService: true }]);
  await b.go(`${BASE}/khoa-hoc/${WITH_ANSWER}/hoc-thu/1`);
  await hydrated();
  check("có giọng tiếng Anh cục bộ → hiện nút Nghe", (await buttons("Nghe")) > 0);
  check("chỉ liệt kê giọng tiếng Anh cục bộ", (await text()).includes("Daniel (en-GB)") && !(await text()).includes("Remote US") && !(await text()).includes("Linh"));
  await b.evaluate(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "Nghe").click()`);
  await sleep(300);
  const spoken = await b.evaluate(`window.__spoken`);
  check("bấm Nghe đọc câu hỏi tiếng Anh bằng giọng cục bộ", spoken.length === 1 && spoken[0].voice === "Daniel" && !/\[/.test(spoken[0].text), JSON.stringify(spoken));
  // Bài 3 mức: thẻ đáp án mẫu ở Mức 2.
  await b.evaluate(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Mức 2"))?.click()`);
  check("bài có đáp án → có thẻ Đáp án mẫu", await waitFor(async () => (await text()).includes("Đáp án mẫu"), 5000));
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/nghe-co-giong.png`);

  // Giọng tới muộn (như Chrome/Android thật): mọi nút Nghe đều phải hiện, không chỉ ô chọn giọng.
  await withVoices([{ name: "Daniel", lang: "en-GB", localService: true }], 1500);
  await b.go(`${BASE}/khoa-hoc/${WITH_ANSWER}/hoc-thu/1`);
  await hydrated();
  const late = await waitFor(async () => (await buttons("Nghe")) >= 2, 8000);
  check("giọng nạp muộn → mọi nút Nghe đều hiện", late, String(await buttons("Nghe")));

  await withVoices([{ name: "Remote US", lang: "en-US", localService: false }]);
  await b.go(`${BASE}/khoa-hoc/${WITH_ANSWER}/hoc-thu/1`);
  await hydrated();
  await sleep(500);
  check("không có giọng cục bộ → không có nút Nghe", (await buttons("Nghe")) === 0);

  await b.go(`${BASE}/khoa-hoc/${WORD}/hoc-thu/1`);
  await hydrated();
  check("bài từ Word: có câu hỏi tiếng Anh", (await text()).includes("Please introduce yourself"));
  check("bài từ Word: không có thẻ Đáp án mẫu, không nút Xem đáp án", !(await text()).includes("Đáp án mẫu") && (await buttons("Xem đáp án")) === 0);
  check("bài từ Word: có câu hỏi tiếp theo", (await text()).includes("Câu hỏi tiếp theo"));
  await b.shot(`${OUT}/bai-tu-word.png`);
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
