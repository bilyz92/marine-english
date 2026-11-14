// Danh mục khóa học (docs/superpowers/plans/2026-11-14-course-categories.md, Task 3).
// node tests/e2e-ui/categories.mjs <địa chỉ gốc> <thư mục ảnh>. Chạy với dev server hoặc bản build. Cần MIGRATOR_DATABASE_URL và biến
// môi trường của CLI (SESSION_KEY_ADMIN, APP_ORIGIN) để in link đăng nhập admin, và ít nhất 2 khóa đang bán chưa có danh mục.
// Tự dọn: cuối cùng bỏ gắn các khóa đã gắn và xóa danh mục đã tạo.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
const stamp = String(Date.now()).slice(-6);
const A = `Sĩ quan vận hành ${stamp}`;
const A_EN = `Fitter X${stamp}`;
const B = `Danh mục ảnh ${stamp}`;
const SUB = `Nhóm thử ${stamp}`;
// PNG 1×1 thật (để trình duyệt vẽ được).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const pngPath = resolve(OUT, `danh-muc-${stamp}.png`);
writeFileSync(pngPath, PNG);

const b = await openBrowser({ port: 9491 });
const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const press = (label) => waitFor(() => b.evaluate(`(() => {
  const el = [...document.querySelectorAll("main button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent.trim()) === ${JSON.stringify(label)} && !e.disabled);
  if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
  el.click();
  return true;
})()`), 30000);
const fill = (label, value) => b.evaluate(`(() => {
  const field = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
  const el = field?.querySelector("input");
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
const choose = (ariaLabel, option) => b.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(`select[aria-label="${ariaLabel}"]`)});
  const opt = el && [...el.options].find((o) => o.textContent.replace(/\\u00a0/g, " ").trim().replace(/^— /, "") === ${JSON.stringify(option)});
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, opt.value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);
const tileKeys = () => b.evaluate(`[...document.querySelectorAll("[data-category-key]")].map((e) => e.dataset.categoryKey)`);
const pageProblems = async () => [...(await b.evaluate(PAGE_CHECKS)), ...(await b.evaluate(`[...document.querySelectorAll("main *")].filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 15 && !e.closest("[class*=srOnly]")).map((e) => "chữ nhỏ: " + e.textContent.trim().slice(0, 30))`))];
const catId = async (title) => (await db.query(`SELECT id FROM course_categories WHERE title_vi = $1`, [title])).rows[0]?.id;

const { rows: picked } = await db.query(`SELECT id, slug, title_vi FROM courses WHERE status = 'published' AND category_id IS NULL ORDER BY slug LIMIT 2`);
if (picked.length < 2) throw new Error("Cần ít nhất 2 khóa đang bán chưa có danh mục trên DB dev");
const [c1, c2] = picked;
try {
  // Chủ đăng nhập.
  const ownerEmail = `chu-dm${stamp}@x.vn`;
  await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1,'owner','active',now(),now()+interval '7 days',now())`, [ownerEmail]);
  await b.width(1280, 900);
  await b.go(`${BASE}/admin/dang-nhap`);
  await waitFor(() => b.evaluate(`Object.keys(document.querySelector("button") ?? {}).some((k) => k.startsWith("__react"))`));
  const link = execSync(`pnpm -s cli admin:login-link ${ownerEmail}`, { env: process.env }).toString().match(/https?:\S+/)?.[0];
  await b.go("about:blank");
  await b.go(link);
  await press("Vào trang quản trị");
  check("chủ đăng nhập", await waitFor(async () => (await b.evaluate("location.pathname")) === "/admin"));

  // Quản trị: tạo 2 danh mục, 1 danh mục con, gắn khóa, đổi thứ tự, xóa danh mục còn khóa bị báo, tải ảnh.
  await b.go(`${BASE}/admin/khoa-hoc`);
  check("quản trị: có khối Danh mục", await see("Tên danh mục mới"));
  await fill("Tên danh mục mới", A);
  await fill("Tên tiếng Anh", A_EN);
  await press("Thêm danh mục");
  check("quản trị: tạo danh mục A", await waitFor(async () => Boolean(await catId(A)), 15000));
  await waitFor(() => b.evaluate(`!document.querySelector("form input[required]")?.value`), 10000);
  await fill("Tên danh mục mới", B);
  await press("Thêm danh mục");
  check("quản trị: tạo danh mục B", await waitFor(async () => Boolean(await catId(B)), 15000));
  await press(`Thêm danh mục con vào ${A}`);
  await see("Tên danh mục con");
  await fill("Tên danh mục con", SUB);
  await press("Thêm danh mục con");
  check("quản trị: tạo danh mục con", await waitFor(async () => (await db.query(`SELECT 1 FROM course_categories WHERE title_vi = $1 AND parent_id = $2`, [SUB, await catId(A)])).rowCount === 1, 15000));
  await waitFor(() => b.evaluate(`!!document.querySelector(${JSON.stringify(`select[aria-label="Danh mục của ${c1.slug}"]`)})`), 15000);
  await waitFor(() => choose(`Danh mục của ${c1.slug}`, SUB), 15000);
  check("quản trị: gắn khóa 1 vào danh mục con", await waitFor(async () => (await db.query(`SELECT category_id FROM courses WHERE id = $1`, [c1.id])).rows[0].category_id === (await catId(SUB)), 15000));
  await waitFor(() => choose(`Danh mục của ${c2.slug}`, B), 15000);
  check("quản trị: gắn khóa 2 vào B", await waitFor(async () => (await db.query(`SELECT category_id FROM courses WHERE id = $1`, [c2.id])).rows[0].category_id === (await catId(B)), 15000));
  const posOf = async (t) => (await db.query(`SELECT position FROM course_categories WHERE title_vi = $1`, [t])).rows[0].position;
  const before = [await posOf(A), await posOf(B)];
  await press(`Xuống: ${A}`);
  check("quản trị: dời A xuống đổi chỗ với B", await waitFor(async () => (await posOf(A)) === before[1] && (await posOf(B)) === before[0], 15000));
  await press(`Xóa: ${B}`);
  check("quản trị: xóa danh mục còn khóa bị báo", await see("Danh mục còn khóa hoặc còn danh mục con", 15000));
  check("quản trị: danh mục vẫn còn", Boolean(await catId(B)));
  const { result: { root } } = await b.send("DOM.getDocument", { depth: -1 });
  const { result: { nodeId } } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: `input[type=file][aria-label="Tải ảnh cho ${B}"]` });
  await b.send("DOM.setFileInputFiles", { nodeId, files: [pngPath] });
  check("quản trị: tải ảnh png cho B", await waitFor(async () => Boolean((await db.query(`SELECT image_asset_id FROM course_categories WHERE title_vi = $1`, [B])).rows[0].image_asset_id), 15000));
  check("quản trị: thấy ảnh xem trước", await waitFor(() => b.evaluate(`!!document.querySelector(${JSON.stringify(`img[alt="Ảnh hiện tại của ${B}"]`)})`), 15000));
  await b.shot(`${OUT}/quan-tri-danh-muc-1280.png`);
  check("không lỗi trang (quản trị)", b.events.errors.length === 0, JSON.stringify(b.events.errors.slice(0, 3)));

  // Khách: lưới ô đúng thứ tự, ô có ảnh không hiện chữ trùng, ô không ảnh hiện tên.
  await b.send("Network.clearBrowserCookies");
  const { groups } = await (await fetch(`${BASE}/api/public/courses`)).json();
  const idA = await catId(A);
  const idB = await catId(B);
  for (const w of [1280, 390]) {
    await b.width(w, 900);
    await b.go(`${BASE}/khoa-hoc`);
    await see("Khóa phỏng vấn ngành máy");
    check(`${w}: ô danh mục đúng thứ tự`, JSON.stringify(await tileKeys()) === JSON.stringify(groups.map((g) => g.key)), JSON.stringify([await tileKeys(), groups.map((g) => g.key)]));
    const problems = await pageProblems();
    check(`${w}: trang Khóa học không lỗi giao diện`, problems.length === 0, problems.join("; "));
    await b.shot(`${OUT}/khoa-hoc-${w}.png`);
  }
  await b.width(1280, 900);
  const tile = (key) => b.evaluate(`(() => { const t = document.querySelector('[data-category-key="${key}"]'); if (!t) return null;
    // Chữ thấy được: phần tử lá có kích thước thật (lớp srOnly bị cắt còn 1px nên không tính).
    const visible = [...t.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1).map((e) => e.textContent).join(" ");
    return { img: !!t.querySelector("img"), alt: t.querySelector("img")?.getAttribute("alt"), visible, name: t.textContent }; })()`);
  const tB = await tile(idB);
  check("ô có ảnh: ảnh trang trí, tên chỉ cho trình đọc màn hình", tB?.img && tB.alt === "" && !tB.visible.includes(B) && tB.name.includes(B), JSON.stringify(tB));
  const tA = await tile(idA);
  check("ô không ảnh: hiện tên Anh và tên Việt", tA && !tA.img && tA.visible.includes(A_EN) && tA.visible.includes(A), JSON.stringify(tA));

  // Mở thẳng một danh mục và Khóa khác, tải lại vẫn đúng nhóm.
  await b.go(`${BASE}/khoa-hoc?dm=${idA}`);
  check("?dm=<id>: tiêu đề danh mục, nút về, danh mục con là h3", (await see(`${A_EN} – ${A}`)) && (await see("← Tất cả chức danh")) && (await b.evaluate(`[...document.querySelectorAll("main h3")].some((h) => h.textContent.trim() === ${JSON.stringify(SUB)})`)));
  check("?dm=<id>: có khóa trong danh mục con", await see(c1.title_vi));
  await b.go(`${BASE}/khoa-hoc?dm=${idA}`);
  check("?dm=<id>: tải lại vẫn đúng nhóm", await see(SUB));
  const problemsA = await pageProblems();
  check("?dm=<id>: không lỗi giao diện", problemsA.length === 0, problemsA.join("; "));
  await b.shot(`${OUT}/khoa-hoc-danh-muc-1280.png`);
  if (groups.some((g) => g.key === "khac")) {
    await b.go(`${BASE}/khoa-hoc?dm=khac`);
    check("?dm=khac: nhóm Khóa khác", (await see("Khóa khác")) && (await see("← Tất cả chức danh")));
    await b.go(`${BASE}/khoa-hoc?dm=khac`);
    check("?dm=khac: tải lại vẫn đúng", await see("← Tất cả chức danh"));
  }
  await b.go(`${BASE}/khoa-hoc?dm=khong-co`);
  check("?dm không tồn tại → lưới danh mục", (await waitFor(async () => (await tileKeys()).length > 0)) && !(await text()).includes("← Tất cả chức danh"));

  // Tìm kiếm: danh sách phẳng; tìm theo tên danh mục cha, danh mục con và tên tiếng Anh.
  const search = async (q) => {
    await b.evaluate(`(() => { const el = document.getElementById("tim-khoa-hoc"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(q)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await see(`khóa khớp “${q}”`, 10000);
    return { tiles: (await tileKeys()).length, text: await text() };
  };
  await b.go(`${BASE}/khoa-hoc`);
  await waitFor(() => b.evaluate(`Object.keys(document.getElementById("tim-khoa-hoc") ?? {}).some((k) => k.startsWith("__react"))`));
  const cont = await search("container");
  check("tìm container: ẩn lưới, ra danh sách phẳng", cont.tiles === 0 && /\d+ khóa khớp “container”/.test(cont.text) && !cont.text.includes("0 khóa khớp"));
  for (const q of [`vận hành ${stamp}`, `nhóm thử ${stamp}`, `x${stamp}`]) {
    const r = await search(q);
    check(`tìm "${q}" ra khóa trong danh mục`, r.text.includes(`1 khóa khớp “${q}”`) && r.text.includes(c1.title_vi), r.text.slice(0, 300));
  }
  const rB = await search(`ảnh ${stamp}`);
  check("tìm theo tên danh mục B ra khóa 2", rB.text.includes(c2.title_vi));

  // Trang chủ: ô "Khóa khác" dẫn tới /khoa-hoc?dm=khac.
  await b.go(`${BASE}/`);
  check("trang chủ: có lưới chức danh", await waitFor(async () => (await tileKeys()).length > 0));
  if (groups.some((g) => g.key === "khac")) {
    await b.evaluate(`document.querySelector('[data-category-key="khac"]').click()`);
    check("trang chủ: bấm Khóa khác → /khoa-hoc?dm=khac", await waitFor(async () => (await b.evaluate("location.pathname + location.search")) === "/khoa-hoc?dm=khac"));
  }
  for (const w of [390, 1280]) {
    await b.width(w, 900);
    await b.go(`${BASE}/`);
    const p = await pageProblems();
    check(`${w}: trang chủ không lỗi giao diện`, p.length === 0, p.join("; "));
  }
  check("không lỗi trang (khách)", b.events.errors.length === 0, JSON.stringify(b.events.errors.slice(0, 3)));
} finally {
  await db.query(`UPDATE courses SET category_id = NULL WHERE id = ANY($1::uuid[])`, [[c1.id, c2.id]]).catch(() => {});
  await db.query(`DELETE FROM course_categories WHERE parent_id IS NOT NULL AND title_vi LIKE $1`, [`%${stamp}`]).catch(() => {});
  await db.query(`DELETE FROM course_categories WHERE title_vi LIKE $1`, [`%${stamp}`]).catch(() => {});
  // Dồn lại vị trí danh mục cấp 1 còn lại (đã xóa thẳng bằng SQL).
  await db.query(`UPDATE course_categories c SET position = r.n FROM (SELECT id, row_number() OVER (ORDER BY position) AS n FROM course_categories WHERE parent_id IS NULL) r WHERE c.id = r.id AND c.position <> r.n`).catch(() => {});
  b.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
