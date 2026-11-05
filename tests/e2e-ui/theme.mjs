// Nút Sáng / Tối (giao diện v2): đổi ngay, nhớ trên máy sau khi tải lại, đổi về được; không lỗi trang.
// node tests/e2e-ui/theme.mjs <địa chỉ gốc>
import { openBrowser } from "./lib.mjs";

const [BASE] = process.argv.slice(2);
const b = await openBrowser({ port: 9473 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const bg = () => b.evaluate(`getComputedStyle(document.body).backgroundColor`);
const press = (label) => waitFor(() => b.evaluate(`(() => { const e = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)} && Object.keys(x).some((k) => k.startsWith("__reactProps"))); e?.click(); return !!e; })()`));
try {
  await b.width(1280);
  await b.go(`${BASE}/khoa-hoc`);
  check("mặc định sáng", (await bg()) === "rgb(237, 241, 237)", await bg());
  check("bấm Tối", await press("Tối"));
  check("nền đen, nút thành Sáng", await waitFor(async () => (await bg()) === "rgb(0, 0, 0)" && (await b.evaluate(`[...document.querySelectorAll("button")].some((e) => e.textContent.trim() === "Sáng")`))));
  await b.go(`${BASE}/`);
  check("tải lại vẫn tối", await waitFor(async () => (await bg()) === "rgb(0, 0, 0)"));
  check("bấm Sáng", await press("Sáng"));
  check("về sáng", await waitFor(async () => (await bg()) === "rgb(237, 241, 237)"));
  check("không lỗi trang", b.events.errors.length === 0, JSON.stringify(b.events.errors.slice(0, 3)));
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
