// Giao diện học 3 mức trên trang học thử. node tests/e2e-ui/study.mjs <địa chỉ gốc> <mã khóa có dữ liệu 3 mức> <thư mục ảnh>
// Khóa phải đang mở bán và bài thử số 1 là A001 của Engine Cadet v6 (đã nhập lại sau ngày 03/11/2026).
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, SLUG, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9450 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const click = async (label) => { const ok = await waitFor(() => b.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`), 10000); if (!ok) check(`bấm được “${label}”`, false); return ok; };
const typeInto = (selector, value) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const pressed = () => b.evaluate(`document.querySelector('[aria-label="Mức hỗ trợ tiếng Anh"] [aria-pressed="true"]')?.textContent ?? ""`);
const URL = `${BASE}/khoa-hoc/${SLUG}/hoc-thu/1`;

try {
  await b.width(390, 900);
  await b.go(URL);
  await b.evaluate("localStorage.clear()");
  await b.go(URL);
  check("mở bài, có 3 nút mức, mặc định Mức 1", (await see("Mức 2 · Cơ bản")) && (await pressed()).includes("Mức 1"));
  check("Mức 1: bước 1/3, câu nhỏ có nghĩa tiếng Việt", (await see("Bước 1/3")) && (await text()).includes("What is your name?") && (await text()).includes("Bạn tên gì?"));
  check("Mức 1: bài tập chưa hiện khi đang học các bước", !(await text()).includes("Tự luyện, không tính điểm"));
  check("đáp án ngắn chưa hiện khi chưa bấm", !(await text()).includes("My name is [name]."));
  await click("Xem đáp án");
  check("bấm Xem đáp án → hiện đáp án ngắn có nhãn [name] (chưa điền hồ sơ)", await see("My name is [name]."));
  await click("Tiếp theo");
  await click("Tiếp theo");
  check("bước 3/3", await see("Bước 3/3"));
  await click("Xong các bước");
  check("hết bước → nút Sang Mức 2", await see("Sang Mức 2"));

  // Bài tập điền từ: sai rồi đúng.
  await typeInto('input[aria-label^="Đáp án: Điền cụm tiếng Anh có nghĩa: tên"]', "age");
  await click("Kiểm tra");
  check("điền sai → Chưa đúng", await see("Chưa đúng"));
  await typeInto('input[aria-label^="Đáp án: Điền cụm tiếng Anh có nghĩa: tên"]', " Name. ");
  await click("Kiểm tra");
  check("điền đúng (hoa thường, dấu chấm) → Đúng", await waitFor(async () => (await b.evaluate(`[...document.querySelectorAll("p")].some((p) => p.textContent === "Đúng")`))));

  // Đổi mức rồi quay lại: câu trả lời bài tập và kết quả còn nguyên.
  await click("Mức 3");
  await click("Mức 1");
  check("đổi mức rồi quay lại → bài tập còn câu trả lời và kết quả", await waitFor(() => b.evaluate(`document.querySelector('input[aria-label^="Đáp án: Điền cụm tiếng Anh có nghĩa: tên"]')?.value === " Name. " && [...document.querySelectorAll("p")].some((p) => p.textContent === "Đúng")`)));

  // Mức 2: chưa thử thì không đối chiếu được; có nháp thì được.
  await click("Sang Mức 2");
  check("Mức 2: đúng mã bài, có 3 ý cần nói", (await see("3 ý cần nói")) && (await text()).includes("Bài A001"));
  check("chưa trả lời → nút đối chiếu bị khóa", await b.evaluate(`[...document.querySelectorAll("button")].find((e) => e.textContent.includes("Đối chiếu đáp án mẫu"))?.disabled === true`));
  await typeInto("textarea", "My name is An. I study marine engineering.");
  await click("Đối chiếu đáp án mẫu");
  check("có nháp → xem được đáp án mẫu", await see("Không cần giống từng chữ"));
  const sc = await b.evaluate(`!!document.querySelector('input[type="radio"]')`);
  check("Mức 2 có bài trắc nghiệm hiểu nghĩa", sc);

  // Mức 3: ẩn tiếng Việt, có đổi cách hỏi, nháp riêng.
  await click("Mức 3");
  check("Mức 3: ẩn nghĩa tiếng Việt của câu hỏi lúc đầu", (await see("Đổi cách hỏi")) && !(await text()).includes("Hãy giới thiệu bản thân"));
  await click("Đổi cách hỏi");
  check("đổi cách hỏi → câu hỏi khác", await see("Can you introduce yourself"));
  check("Mức 3 có câu hỏi phụ", (await text()).includes("Câu hỏi phụ"));

  // Nháp còn sau khi đổi mức và tải lại.
  await b.go(URL);
  await see("Mức 3");
  check("tải lại → nhớ Mức 3", (await pressed()).includes("Mức 3"));
  await click("Mức 2");
  check("nháp Mức 2 còn sau khi tải lại", await waitFor(() => b.evaluate(`document.querySelector("textarea")?.value === "My name is An. I study marine engineering."`)));

  // Hồ sơ: điền tên → đáp án dùng tên thật.
  await click("Điền thông tin");
  await b.evaluate(`(() => { const label = [...document.querySelectorAll("label")].find((l) => l.textContent.startsWith("Họ và tên")); const el = label.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Nguyễn Văn An"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await click("Lưu thông tin");
  await click("Mức 1");
  await click("Học lại từ bước 1");
  await click("Xem đáp án");
  check("điền hồ sơ → đáp án ngắn dùng tên thật", await see("My name is Nguyễn Văn An."));

  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn, ô có nhãn", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/hoc-3-muc-390.png`);
  await b.width(1280, 900);
  await b.shot(`${OUT}/hoc-3-muc-1280.png`);
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
