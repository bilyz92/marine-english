// Module khóa học + bài tự luận (docs/superpowers/plans/2026-11-08-course-modules.md).
// node tests/e2e-ui/modules.mjs <địa chỉ gốc> <thư mục ảnh>. Chạy với bản build thật (`pnpm build` rồi `next start`): bản dev không mở lại
// được trang /hoc khi mất mạng. Cần MIGRATOR_DATABASE_URL và biến môi trường của CLI (SESSION_KEY_ADMIN, APP_ORIGIN) để in link đăng nhập admin.
// Mỗi IP chỉ đăng ký được 5 tài khoản mỗi giờ: chạy lại nhiều lần thì xóa password_attempts trên DB dev trước.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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
const stamp = String(Date.now()).slice(-7);
const SLUG = `tu_luan_${stamp}`;
const QUESTION = "Describe how you prepare the main engine before departure.";
const ANSWER = "First, I check the lube oil level and the cooling water.";
const HIDDEN_QUESTION = "Which alarms do you test before taking over the engine room watch?";

function helpers(b) {
  const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
  const waitFor = async (fn, ms = 120000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
  const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
  const button = (label) => `[...document.querySelectorAll("main button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)})`;
  const typeEssay = (value) => b.evaluate(`(() => {
    const el = document.querySelector("main textarea");
    if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  return { text, waitFor, see, button, typeEssay };
}
/** Gọi API trong trang (cookie và CSRF của khu vực đó). */
const api = (b, realm, method, path, body) => b.evaluate(`(async () => {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_${realm}="))?.split("=")[1];
  const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} });
  return { status: r.status, body: await r.json().catch(() => null) };
})()`);
async function learner(b, name) {
  await b.go(`${BASE}/khoa-hoc`);
  return b.evaluate(`(async () => {
    const dk = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const reg = await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "09" + String(Date.now()).slice(-8), password: "mat-khau-thu-123", displayName: ${JSON.stringify(name)}, rank: null, deviceKey: dk, deviceLabel: "Máy thử" }) });
    if (!reg.ok) return null;
    return (await (await fetch("/api/me/session")).json()).userId ?? null;
  })()`);
}

const admin = await openBrowser({ port: 9483 });
const a = helpers(admin);
try {
  // Chủ: khóa mới, một bài tự luận (bài 1 nên là bài học thử), mở bán.
  const ownerEmail = `chu-mod${stamp}@x.vn`;
  await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1,'owner','active',now(),now()+interval '7 days',now())`, [ownerEmail]);
  await admin.width(1280, 900);
  await admin.go(`${BASE}/admin/dang-nhap`);
  await a.waitFor(() => admin.evaluate(`Object.keys(document.querySelector("button") ?? {}).some((k) => k.startsWith("__react"))`));
  // Link đăng nhập lấy từ CLI (chạy được cả với bản build thật, không cần hộp thư giả).
  const link = execSync(`pnpm -s cli admin:login-link ${ownerEmail}`, { env: process.env }).toString().match(/https?:\S+/)?.[0];
  await admin.go("about:blank");
  await admin.go(link);
  await a.waitFor(() => admin.evaluate(`(() => { const e = ${a.button("Vào trang quản trị")}; if (!e || !Object.keys(e).some((k) => k.startsWith("__reactProps"))) return false; e.click(); return true; })()`));
  check("chủ đăng nhập", await a.waitFor(async () => (await admin.evaluate("location.pathname")) === "/admin"));
  check("tạo khóa", (await api(admin, "admin", "POST", "/api/quan-tri/content/courses", { slug: SLUG, titleVi: "Khóa tự luận thử", titleEn: "Essay test course" })).status === 200);
  const added = await api(admin, "admin", "POST", `/api/quan-tri/content/courses/${SLUG}/lessons`, {
    expectedVersionId: null, lessonType: "essay", questionEn: QUESTION, questionVi: "Mô tả cách chuẩn bị máy chính trước khi tàu chạy.",
    keyPoints: [{ en: "Lube oil", vi: "Dầu bôi trơn" }], vocabulary: [], modelAnswerEn: ANSWER, modelAnswerVi: "Trước hết tôi kiểm tra dầu bôi trơn.", followUps: [],
  });
  check("thêm bài tự luận", added.status === 200, JSON.stringify(added));
  const { rows: [course] } = await db.query(`SELECT id FROM courses WHERE slug = $1`, [SLUG]);

  // Trang quản trị (Task 5): tạo module, bài cũ vào module đầu; thêm bài tự luận vào module 2; đổi thứ tự; xóa module còn bài bị báo.
  const ui = {
    fill: (label, value) => admin.evaluate(`(() => {
      const field = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
      const el = field?.querySelector("input,textarea");
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`),
    choose: (label, option) => admin.evaluate(`(() => {
      const field = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
      const el = field?.querySelector("select");
      const opt = el && [...el.options].find((o) => o.textContent.trim() === ${JSON.stringify(option)});
      if (!opt) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, opt.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`),
    press: (label) => a.waitFor(() => admin.evaluate(`(() => {
      const el = [...document.querySelectorAll("main button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent.trim()) === ${JSON.stringify(label)} && !e.disabled);
      if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
      el.click();
      return true;
    })()`), 30000),
    labels: () => admin.evaluate(`[...document.querySelectorAll("main label")].map((l) => l.textContent.trim())`),
  };
  const inModule = async (externalId) => (await db.query(
    `SELECT m.title_vi FROM course_lesson_modules clm JOIN course_modules m ON m.id = clm.module_id JOIN lessons l ON l.id = clm.lesson_id WHERE clm.course_id = $1 AND l.external_id = $2`,
    [course.id, externalId])).rows[0]?.title_vi ?? null;
  await admin.go(`${BASE}/admin/khoa-hoc/${SLUG}`);
  check("quản trị: chưa có module thì có lời dặn", await a.see("Tạo module đầu tiên: mọi bài hiện có sẽ vào module này."));
  await ui.fill("Tên module mới", "Kinh nghiệm phỏng vấn");
  await ui.press("Thêm module");
  check("quản trị: tạo module 1", await a.see("Module 1 · Kinh nghiệm phỏng vấn"));
  check("quản trị: bài cũ vào module 1", await a.waitFor(async () => (await inModule(`${SLUG}-b1`)) === "Kinh nghiệm phỏng vấn", 10000));
  await ui.fill("Tên module mới", "Kinh nghiệm vận hành");
  await ui.press("Thêm module");
  check("quản trị: tạo module 2", await a.see("Module 2 · Kinh nghiệm vận hành"));
  await ui.press("Thêm bài");
  await a.see("Thêm bài cuối khóa");
  check("quản trị: chọn loại Tự luận", await ui.choose("Loại bài", "Tự luận"));
  check("quản trị: tự luận thì hỏi Đề bài, không có câu hỏi phụ", await a.waitFor(async () => {
    const labels = await ui.labels();
    return labels.some((t) => t.startsWith("Đề bài · tiếng Anh")) && !(await a.text()).includes("Thêm câu hỏi phụ");
  }, 10000));
  await ui.fill("Đề bài · tiếng Anh", "Explain how you would stop the main engine in an emergency.");
  await ui.fill("Đáp án mẫu · tiếng Anh", "I would inform the bridge and follow the emergency stop procedure.");
  check("quản trị: chọn module cho bài mới", await ui.choose("Xếp vào module", "Kinh nghiệm vận hành"));
  await ui.press("Lưu bài");
  check("quản trị: thêm bài tự luận vào module 2", await a.see(`Đã thêm bài ${SLUG}-b2`) && (await inModule(`${SLUG}-b2`)) === "Kinh nghiệm vận hành");
  check("quản trị: bài mới là tự luận", (await db.query(
    `SELECT lv.content->>'lesson_type' AS t FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = $1 ORDER BY lv.created_at DESC LIMIT 1`, [`${SLUG}-b2`])).rows[0]?.t === "essay");
  await ui.press("Đưa lên: Kinh nghiệm vận hành");
  check("quản trị: đổi thứ tự module", await a.see("Module 1 · Kinh nghiệm vận hành"));
  await ui.press("Xóa module: Kinh nghiệm phỏng vấn");
  check("quản trị: xóa module còn bài bị báo", await a.see("Module còn bài"));
  check("quản trị: đổi module của bài", await ui.choose(`Module của bài ${SLUG}-b1`, "Kinh nghiệm vận hành"));
  check("quản trị: báo đã chuyển bài", await a.see(`Đã chuyển bài ${SLUG}-b1`) && (await inModule(`${SLUG}-b1`)) === "Kinh nghiệm vận hành");
  await ui.press("Xóa module: Kinh nghiệm phỏng vấn");
  check("quản trị: xóa module rỗng", await a.see("Đã xóa module “Kinh nghiệm phỏng vấn”.", 15000) && !(await a.text()).includes("Module 2 ·")
    && (await db.query(`SELECT count(*)::int AS n FROM course_modules WHERE course_id = $1`, [course.id])).rows[0].n === 1);
  // Khung bài giảng Excel (Task 8): tải khung về, tải lên chính khung mẫu, xem trước, thêm 2 bài.
  const template = await admin.evaluate(`fetch("/api/quan-tri/content/template").then(async (r) => ({ status: r.status, head: new Uint8Array(await r.arrayBuffer()).slice(0, 2).join(",") }))`);
  check("excel: tải khung về được (xlsx)", template.status === 200 && template.head === "80,75", JSON.stringify(template));
  check("excel: có nút tải khung", await a.see("Tải khung bài giảng (Excel)"));
  {
    const { result: { root } } = await admin.send("DOM.getDocument", { depth: -1 });
    const { result: { nodeId } } = await admin.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type=file][accept^=".xlsx"]' });
    await admin.send("DOM.setFileInputFiles", { nodeId, files: [resolve("src/assets/khung-bai-giang-mau.xlsx")] });
  }
  await ui.press("Xem trước");
  check("excel: xem trước 2 bài, 2 module mới", await a.see("2 bài sẽ được thêm vào cuối khóa. Module mới: Kinh nghiệm phỏng vấn, Kinh nghiệm vận hành sửa chữa."));
  await ui.press("Thêm 2 bài");
  check("excel: đã thêm 2 bài", await a.see("Đã thêm 2 bài từ file Excel."));
  check("excel: bài tự luận vào đúng module", (await inModule(`${SLUG}-b4`)) === "Kinh nghiệm vận hành sửa chữa" && (await inModule(`${SLUG}-b3`)) === "Kinh nghiệm phỏng vấn");
  for (const w of [1280, 360]) {
    await admin.width(w, 900);
    await sleep(300);
    const problems = await admin.evaluate(PAGE_CHECKS);
    check(`quản trị: không lỗi giao diện @${w}`, problems.length === 0, JSON.stringify(problems));
    await admin.shot(`${OUT}/quan-tri-module-${w}.png`);
  }
  await admin.width(1280, 900);

  // Bài 5, 6 (hỏi–đáp) vào module đầu: trang công khai không được lộ câu hỏi của bài không học thử.
  const { rows: [mod] } = await db.query(`SELECT id::text AS id FROM course_modules WHERE course_id = $1 ORDER BY position LIMIT 1`, [course.id]);
  for (const q of ["How do you check the purifier?", HIDDEN_QUESTION]) {
    const { rows: [{ v }] } = await db.query(`SELECT current_version_id::text AS v FROM courses WHERE id = $1`, [course.id]);
    const r = await api(admin, "admin", "POST", `/api/quan-tri/content/courses/${SLUG}/lessons`, {
      expectedVersionId: v, lessonType: "qa", moduleId: mod.id, questionEn: q, questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    });
    check(`thêm bài hỏi–đáp “${q.slice(0, 20)}”`, r.status === 200, JSON.stringify(r));
  }
  check("mở bán", (await api(admin, "admin", "PATCH", `/api/quan-tri/courses/${course.id}`, { priceVnd: 99000, status: "published" })).status === 200);

  // (a) Học thử bài tự luận (khách, sessionStorage).
  const g = await openBrowser({ port: 9484 });
  const gh = helpers(g);
  try {
    await g.width(390, 900);
    // Trang khóa (khách): chỉ module; bài không học thử là dòng mờ, câu hỏi thật không có trong trang (Task 7).
    await g.go(`${BASE}/khoa-hoc`);
    const html = await g.evaluate(`fetch("/khoa-hoc/${SLUG}").then((r) => r.text())`);
    const publicApi = await g.evaluate(`fetch("/api/public/courses/${SLUG}").then((r) => r.text())`);
    for (const hidden of [HIDDEN_QUESTION, "What is a marine diesel engine"]) {
      check(`trang khóa: HTML không có câu hỏi bài không học thử (${hidden.slice(0, 20)}…)`, html.length > 1000 && !html.includes(hidden));
      check(`API công khai: không có câu hỏi bài không học thử (${hidden.slice(0, 20)}…)`, !publicApi.includes(hidden));
    }
    await g.go(`${BASE}/khoa-hoc/${SLUG}`);
    check("trang khóa: thấy module", await gh.see("Kinh nghiệm vận hành"));
    check("trang khóa: 3 nút Học thử", await g.evaluate(`[...document.querySelectorAll("main a")].filter((e) => e.textContent.trim() === "Học thử").length`) === 3);
    check("trang khóa: có dòng mờ và lời mời mua", await g.evaluate(`!!document.querySelector("li[aria-hidden=true]")`) && (await gh.text()).includes("Mua khóa để mở 2 bài còn lại."));
    for (const w of [1280, 390]) {
      await g.width(w, 900);
      await sleep(300);
      const coursePage = await g.evaluate(PAGE_CHECKS);
      check(`trang khóa: không lỗi giao diện @${w}`, coursePage.length === 0, JSON.stringify(coursePage));
      await g.shot(`${OUT}/trang-khoa-${w}.png`);
    }
    await g.go(`${BASE}/khoa-hoc/${SLUG}/hoc-thu/1`);
    check("học thử: thấy đề tự luận", await gh.see(QUESTION));
    check("học thử: nhãn Tự luận", (await gh.text()).includes("Tự luận"));
    check("học thử: chưa viết thì nút đối chiếu khóa", await g.evaluate(`${gh.button("Đối chiếu đáp án mẫu")}?.disabled === true`));
    check("học thử: gõ được bài", await gh.waitFor(() => gh.typeEssay("I check the oil.")));
    await sleep(300);
    await g.evaluate(`${gh.button("Đối chiếu đáp án mẫu")}?.click()`);
    check("học thử: viết rồi mở được đáp án", await gh.see(ANSWER, 10000));
    const problems = await g.evaluate(PAGE_CHECKS);
    check("học thử: không lỗi giao diện @390", problems.length === 0, JSON.stringify(problems));
    await g.shot(`${OUT}/tu-luan-hoc-thu-390.png`);
    await g.go(`${BASE}/khoa-hoc/${SLUG}/hoc-thu/1`);
    check("học thử: tải lại trang vẫn còn nháp", await gh.waitFor(() => g.evaluate(`document.querySelector("main textarea")?.value === "I check the oil."`)));
  } finally {
    g.close();
  }

  // (b) Học viên A: tải khóa về máy, viết nháp, mất mạng vẫn mở bài và còn nháp; học viên B cùng máy không thấy nháp của A.
  const l = await openBrowser({ port: 9485 });
  const lh = helpers(l);
  try {
    await l.width(390, 900);
    const userA = await learner(l, "Học viên A");
    check("học viên A", !!userA);
    check("cấp khóa cho A", (await api(admin, "admin", "POST", "/api/quan-tri/grants", { userId: userA, courseId: course.id, reason: "Kiểm thử tự luận" })).status === 201);
    await l.go(`${BASE}/hoc?khoa=${SLUG}`);
    check("A thấy nút tải khóa", await lh.see("Tải khóa về máy"), `${await l.evaluate("location.href")} · ${(await lh.text()).slice(0, 400)}`);
    await lh.waitFor(() => l.evaluate(`(() => { const e = [...document.querySelectorAll("main button")].find((x) => x.textContent.trim() === "Tải khóa về máy" && Object.keys(x).some((k) => k.startsWith("__reactProps"))); e?.click(); return !!e; })()`));
    check("A tải xong (khối tải biến mất)", await lh.waitFor(async () => !(await lh.text()).includes("Tải khóa về máy")));
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=1`);
    check("A mở bài tự luận", await lh.see(QUESTION));
    check("A gõ nháp", await lh.waitFor(() => lh.typeEssay("Nháp của A")));
    await sleep(500);
    await l.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=1`);
    check("mất mạng: bài vẫn mở", await lh.see(QUESTION, 60000), (await lh.text()).slice(0, 400));
    await l.shot(`${OUT}/tu-luan-mat-mang.png`);
    check("mất mạng: còn nháp", await lh.waitFor(() => l.evaluate(`document.querySelector("main textarea")?.value === "Nháp của A"`), 30000));
    await l.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    await l.send("Network.clearBrowserCookies");
    const userB = await learner(l, "Học viên B");
    check("cấp khóa cho B", (await api(admin, "admin", "POST", "/api/quan-tri/grants", { userId: userB, courseId: course.id, reason: "Kiểm thử tự luận" })).status === 201);
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=1`);
    check("B mở bài tự luận", await lh.see(QUESTION));
    check("B: ô viết có và trống", await lh.waitFor(() => l.evaluate(`document.querySelector("main textarea")?.value === ""`), 30000));
    check("không lỗi trang (học viên)", l.events.errors.filter((e) => !String(e).includes("Failed to fetch")).length === 0, JSON.stringify(l.events.errors.slice(0, 3)));
  } finally {
    l.close();
  }
} finally {
  admin.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
