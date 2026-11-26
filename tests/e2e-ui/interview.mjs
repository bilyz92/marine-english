// Bài luyện phỏng vấn Engine Cadet 3 mức (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 7).
// node tests/e2e-ui/interview.mjs <địa chỉ gốc> <thư mục ảnh>. Chạy với bản build thật (`pnpm build` rồi `next start`), cần
// MIGRATOR_DATABASE_URL và biến của CLI (SESSION_KEY_ADMIN, APP_ORIGIN) để in link đăng nhập quản trị. Chủ nhập tệp
// tests/fixtures/engine-cadet-interview.xlsx ở /admin/noi-dung (khóa nháp mea_cadet_interview, giữ lại sau khi chạy), học viên mới
// được cấp khóa học ở 360px: L1/L2/L3, ghi âm bằng micro giả của Chrome, micro bị từ chối, đổi giọng (giọng đọc giả lập: Chrome
// không giao diện không có giọng), học lại đổi cách hỏi, điền hồ sơ, mất mạng. Cuối bài dọn học viên thử (gỡ phiên, thiết bị, thu hồi
// quyền học; dòng học viên và nhật ký học chỉ ghi thêm nên còn lại) và thu hồi quản trị viên thử.
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
const SLUG = "mea_cadet_interview";
const created = { admin: null, users: [] };

// Giọng đọc giả lập: ghi lại câu, giọng, tốc độ được đọc. Ghi lại mọi luồng micro để kiểm đã tắt khi rời bài.
const STUBS = `(() => {
  const voices = [
    { name: "US", lang: "en-US", localService: true, voiceURI: "us", default: true },
    { name: "PH", lang: "en-PH", localService: true, voiceURI: "ph", default: false },
    { name: "VN", lang: "vi-VN", localService: true, voiceURI: "vn", default: false },
  ];
  window.__spoken = [];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const synth = {
    getVoices: () => voices, speaking: false, pending: false,
    // Như trình duyệt thật: cancel() làm câu đang đọc báo lỗi "interrupted" (muộn, sau khi câu mới đã bắt đầu).
    cancel() { const u = window.__current; window.__current = null; if (u) setTimeout(() => u.onerror && u.onerror({ error: "interrupted" }), 0); },
    speak(u) { window.__current = u; window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); setTimeout(() => { if (window.__current === u) { window.__current = null; u.onend && u.onend(); } }, 50); },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.__streams = [];
  if (navigator.mediaDevices?.getUserMedia) {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await real(c); window.__streams.push(s); return s; };
  }
})()`;

function helpers(b) {
  const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
  const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
  const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
  const press = (label, { exact = true, within = "main" } = {}) => waitFor(() => b.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(`${within} button`)})].find((e) => {
      const t = (e.getAttribute("aria-label") ?? e.textContent).trim();
      return (${exact} ? t === ${JSON.stringify(label)} : t.startsWith(${JSON.stringify(label)})) && !e.disabled;
    });
    if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
    el.click();
    return true;
  })()`), 15000);
  return { text, waitFor, see, press };
}

const admin = await openBrowser({ port: 9491 });
const a = helpers(admin);
const learnerB = await openBrowser({ port: 9492, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const l = helpers(learnerB);
try {
  // ===== Chủ nhập tệp Excel ở /admin/noi-dung =====
  const ownerEmail = `chu-iv${stamp}@x.vn`;
  created.admin = (await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1,'owner','active',now(),now()+interval '7 days',now()) RETURNING id`, [ownerEmail])).rows[0].id;
  await admin.width(1280, 900);
  await admin.go(`${BASE}/admin/dang-nhap`);
  const link = execSync(`pnpm -s cli admin:login-link ${ownerEmail}`, { env: process.env }).toString().match(/https?:\S+/)?.[0];
  await admin.go("about:blank");
  await admin.go(link);
  await a.press("Vào trang quản trị");
  check("chủ đăng nhập", await a.waitFor(async () => (await admin.evaluate("location.pathname")) === "/admin"));
  await admin.go(`${BASE}/admin/noi-dung`);
  await a.see("bộ luyện phỏng vấn");
  {
    const { result: { root } } = await admin.send("DOM.getDocument", { depth: -1 });
    const { result: { nodeId } } = await admin.send("DOM.querySelector", { nodeId: root.nodeId, selector: "main input[type=file]" });
    await admin.send("DOM.setFileInputFiles", { nodeId, files: [resolve("tests/fixtures/engine-cadet-interview.xlsx")] });
  }
  await a.press("Xem trước");
  const existed = (await db.query(`SELECT 1 FROM courses WHERE slug = $1`, [SLUG])).rowCount > 0;
  check("xem trước: 1 khóa, 87 bài", await a.see(`${SLUG} · 87 bài`, 30000), (await a.text()).slice(0, 600));
  if (!existed) check("xem trước: khóa mới (nháp)", await a.see("Khóa mới (nháp)"));
  await admin.shot(`${OUT}/noi-dung-xem-truoc.png`);
  if (await a.press("Nhập vào hệ thống")) check("đã nhập", await a.see("Đã nhập 1 khóa", 30000));
  else check("nhập lại: không có gì mới", await a.see("Không có gì mới để nhập"));
  const { rows: [course] } = await db.query(`SELECT id, status FROM courses WHERE slug = $1`, [SLUG]);
  check("khóa ở dạng nháp", course?.status === "draft", JSON.stringify(course));
  await admin.go(`${BASE}/admin/khoa-hoc/${SLUG}`);
  check("quản trị: bài phỏng vấn không có nút Sửa", await a.see("Luyện phỏng vấn (sửa bằng tệp Excel") && !(await admin.evaluate(`[...document.querySelectorAll("main button")].some((e) => e.textContent.trim() === "Sửa")`)));

  // ===== Học viên mới, được cấp khóa =====
  await learnerB.send("Page.addScriptToEvaluateOnNewDocument", { source: STUBS });
  await learnerB.width(360, 800);
  await learnerB.go(`${BASE}/khoa-hoc`);
  const userId = await learnerB.evaluate(`(async () => {
    const dk = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const reg = await fetch("/api/auth/learner/password/register", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "09" + String(Date.now()).slice(-8), password: "mat-khau-thu-123", displayName: "Học viên phỏng vấn", rank: null, deviceKey: dk, deviceLabel: "Máy thử" }) });
    if (!reg.ok) return "reg " + reg.status;
    return (await (await fetch("/api/me/session")).json()).userId ?? null;
  })()`);
  check("học viên đăng ký", /^[0-9a-f-]{36}$/.test(userId ?? ""), String(userId));
  created.users.push(userId);
  await db.query(`INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by) VALUES ($1, $2, 'grant', 'Kiểm thử luyện phỏng vấn', $3)`, [userId, course.id, created.admin]);

  const lesson = (n) => `${BASE}/hoc?khoa=${SLUG}&bai=${n}`;
  await learnerB.go(`${BASE}/hoc?khoa=${SLUG}`);
  check("danh sách bài: chủ đề và nhãn Luyện nói", await l.see("Giới thiệu và học vấn", 30000) && await l.see("Luyện nói"));
  await l.press("Tải khóa về máy");
  check("tải khóa xong", await l.waitFor(async () => !(await l.text()).includes("Tải khóa về máy"), 60000));
  await learnerB.shot(`${OUT}/danh-sach-360.png`);

  // ----- EC-002, L1 -----
  await learnerB.go(lesson(2));
  check("L1 mặc định, bước 1: lời dẫn tiếng Việt", await l.see("Bước 1/5", 30000) && await l.see("Người phỏng vấn hỏi vì sao bạn chọn ngành máy"));
  check("có bộ chọn giọng Mỹ/Anh/Ấn Độ, tốc độ", await l.see("Mỹ") && await l.see("Ấn Độ") && await l.see("Chậm"));
  check("không có nút Chấm phát âm, không có nút đánh dấu xong chung", !(await l.text()).includes("Chấm phát âm") && !(await l.text()).includes("Đánh dấu đã học xong"));
  await l.press("Nghe hướng dẫn");
  check("lời dẫn đọc bằng giọng Việt", await l.waitFor(() => learnerB.evaluate(`window.__spoken.at(-1)?.lang === "vi-VN"`)));
  await l.press("Tiếp theo →");
  check("bước 2: chưa chọn thì không đi tiếp", await l.see("Bước 2/5") && await learnerB.evaluate(`[...document.querySelectorAll("main button")].find((e) => e.textContent.trim() === "Tiếp theo →")?.disabled === true`));
  await l.press("Nhiệm vụ khi trực ca");
  check("chọn sai → Chưa đúng, phát lại cụm và câu hỏi", await l.see("Chưa đúng") && await learnerB.evaluate(`window.__spoken.at(-1)?.text.includes("Why did you choose")`));
  await learnerB.shot(`${OUT}/l1-chon-sai-360.png`);
  await l.press("Lý do chọn ngành máy");
  check("chọn đúng → Đúng rồi", await l.see("Đúng rồi"));
  await l.press("Tiếp theo →");
  check("bước 3: cụm then chốt + từ thêm", await l.see("Why did you choose") && await l.see("machinery") && await l.see("Từ nghe thêm"));
  await l.press("Tiếp theo →");
  check("bước 4: câu đầu đọc theo", await l.see("I like machinery.") && await l.see("Tôi thích máy móc."));
  // Đổi giọng và tốc độ.
  await l.press("Nghe");
  check("đọc bằng giọng Mỹ, tốc độ thường", await l.waitFor(() => learnerB.evaluate(`(() => { const s = window.__spoken.at(-1); return s?.text === "I like machinery." && s.lang === "en-US" && s.rate === 1; })()`)));
  await l.press("Philippines");
  await l.press("Chậm");
  await l.press("Nghe");
  check("đổi sang giọng Philippines, chậm", await l.waitFor(() => learnerB.evaluate(`(() => { const s = window.__spoken.at(-1); return s?.lang === "en-PH" && s.rate === 0.6; })()`)));
  await l.press("Ấn Độ");
  check("máy không có giọng Ấn Độ → báo rõ, đọc bằng giọng khác", await l.see("Máy chưa có giọng Ấn Độ, đang đọc bằng giọng en-US"));
  await l.press("Thường");
  await l.press("Mỹ");

  // Ghi âm (micro giả), không có yêu cầu mạng nào mang âm thanh.
  const queue = () => learnerB.evaluate(`(async () => {
    const who = JSON.parse(localStorage.getItem("me-identity"));
    const db = await new Promise((r, j) => { const q = indexedDB.open("me-offline-" + who.userId + "-" + who.deviceId); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const all = (store) => new Promise((r) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
    const out = { queue: await all("queue"), recordings: (await all("recordings")).map((x) => x.key) };
    db.close();
    return { completed: out.queue.filter((e) => e.type === "lesson_completed").length, recordings: out.recordings };
  })()`);
  const before = learnerB.events.requests.length;
  await l.press("Ghi âm");
  check("đang ghi âm", await l.see("Đang ghi âm"));
  await sleep(1500);
  await l.press("Dừng ghi âm");
  check("sau khi dừng: Nghe giọng mình, Nghe mẫu, Thu lại, Xóa bản thu", await l.see("Nghe giọng mình") && await l.see("Nghe mẫu") && await l.see("Thu lại") && await l.see("Xóa bản thu"));
  await l.press("Nghe giọng mình");
  await sleep(800);
  // Biểu tượng trang do trình duyệt tự tải, không phải app gửi.
  const sent = learnerB.events.requests.slice(before).filter((u) => !u.startsWith("blob:") && !u.startsWith("data:") && !new URL(u).pathname.startsWith("/favicon"));
  check("ghi âm và nghe lại không gửi gì lên mạng", sent.length === 0, JSON.stringify(sent));
  check("thu khi chưa ẩn tiếng Anh: chưa xong bài", (await queue()).completed === 0, JSON.stringify(await queue()));
  await l.press("Ẩn tiếng Anh");
  check("ẩn tiếng Anh → dòng đã ẩn", await l.see("Dòng tiếng Anh đã ẩn") && !(await l.text()).includes("I like machinery."));
  await l.press("Ẩn tiếng Việt");
  check("ẩn tiếng Việt sau tiếng Anh", await l.see("Dòng tiếng Việt đã ẩn"));
  await learnerB.shot(`${OUT}/l1-an-chu-360.png`);
  await l.press("Thu lại");
  await sleep(1200);
  await l.press("Dừng ghi âm");
  // Sự kiện xong bài có thể đã đồng bộ (rời hàng đợi): đếm cả hàng đợi trên máy và sự kiện máy chủ đã nhận.
  const completions = async () => (await queue()).completed + Number((await db.query(
    `SELECT count(*)::int AS n FROM learning_events e JOIN lesson_versions lv ON lv.id = e.lesson_version_id JOIN lessons x ON x.id = lv.lesson_id
     WHERE e.user_id = $1 AND x.external_id = 'EC-002' AND e.type = 'lesson_completed'`, [userId]).catch(() => ({ rows: [{ n: -100 }] }))).rows[0].n);
  check("thu khi đã ẩn tiếng Anh → xong bài (đúng một sự kiện)", await l.see("Đã xong bài này") && await l.waitFor(async () => (await completions()) === 1), String(await completions()));
  await l.press("Tiếp theo →");
  check("bước 5: các đoạn của đáp án cơ bản", await l.see("Because I like machinery and technical work.") && await l.see("Cả đáp án cơ bản"));
  const recButtons = await learnerB.evaluate(`[...document.querySelectorAll("main [data-rec]")].length`);
  check("bước 5: mỗi đoạn và cả bài có nút ghi âm", recButtons >= 3, String(recButtons));
  await learnerB.evaluate(`[...document.querySelectorAll("main [data-rec]")][0].querySelector("button").click()`);
  await sleep(1200);
  await l.press("Dừng ghi âm");
  check("bước 5: thu một đoạn", await l.waitFor(async () => (await queue()).recordings.some((k) => k.startsWith("EC-002|L1|EC-002-B1|"))));
  await learnerB.shot(`${OUT}/l1-buoc-5-360.png`);

  // ----- L2 -----
  await l.press("Luyện từng ý", { exact: false, within: "[aria-label='Mức luyện']" });
  check("L2: đoạn 1 có nghĩa", await l.see("Đoạn 1/3") && await l.see("Because I like machinery and technical work.") && await l.see("Bởi vì tôi yêu thích máy móc"));
  await l.press("Chỉ giữ từ khóa");
  check("L2: chỉ giữ từ khóa", await l.see("Gợi ý:") && await l.see("Dòng tiếng Anh đã ẩn"));
  await l.press("Hiện mẫu");
  await l.press("Ghi âm");
  await sleep(1000);
  await l.press("Dừng ghi âm");
  check("L2: thu đoạn 1", await l.see("Nghe giọng mình"));
  await l.press("Đoạn tiếp →");
  check("L2: đoạn 2", await l.see("Đoạn 2/3"));
  await l.press("Đoạn tiếp →");
  await l.press("Ghép cả bài →");
  check("L2: ghép cả đáp án cơ bản", await l.see("Ghép cả đáp án") && await l.see("I also want to work in an international environment"));
  await l.press("Ghi âm");
  await sleep(1000);
  await l.press("Dừng ghi âm");
  check("L2: thu cả bài, vẫn một sự kiện xong bài", await l.see("Nghe giọng mình") && (await completions()) === 1, String(await completions()));
  await learnerB.shot(`${OUT}/l2-ghep-360.png`);

  // ----- L3 -----
  await l.press("Đọc theo mẫu nâng cao", { exact: false, within: "[aria-label='Mức luyện']" });
  check("L3: đáp án nâng cao, câu hỏi không kèm tiếng Việt", await l.see("I want to join the engine department")
    // Tiêu đề ẩn cho trình đọc màn hình ("Bài 2: …") là tên bài, không phải dòng câu hỏi.
    && await l.waitFor(async () => !(await l.text()).replace("Bài 2: Tại sao bạn chọn ngành máy tàu thủy?", "").includes("Tại sao bạn chọn ngành máy tàu thủy?")),
    await learnerB.evaluate(`(() => { const t = document.body.innerText; const i = t.indexOf("Tại sao bạn chọn ngành máy tàu thủy?"); return t.slice(Math.max(0, i - 200), i + 60); })()`));
  await l.press("Ẩn chữ");
  check("L3: ẩn chữ", await l.see("Dòng tiếng Anh đã ẩn"));
  await l.press("Nghe");
  check("L3: nghe cả bài nâng cao", await l.waitFor(() => learnerB.evaluate(`window.__spoken.at(-1)?.text.startsWith("I want to join the engine department")`)));
  await l.press("Ghi âm");
  await sleep(1000);
  await l.press("Dừng ghi âm");
  check("L3: thu bài nâng cao", await l.see("Nghe giọng mình"));
  await l.press("Ý chuyên môn cần có");
  check("ý chuyên môn mở được", await l.see("Tiêu chí đánh giá"));
  await learnerB.shot(`${OUT}/l3-360.png`);
  await l.press("Tập từ đầu", { exact: false, within: "[aria-label='Mức luyện']" });
  check("quay lại L1: giữ đúng bước 5", await l.see("Bước 5/5"));
  for (const problem of await learnerB.evaluate(PAGE_CHECKS)) check(`giao diện 360px: ${problem}`, false);

  // ----- Rời bài: micro đã tắt -----
  await l.press("Ghi âm");
  await l.see("Đang ghi âm");
  await l.press("← Danh sách bài");
  await sleep(500);
  check("rời bài khi đang thu: micro đã tắt", await learnerB.evaluate(`window.__streams.length > 0 && window.__streams.every((s) => s.getTracks().every((t) => t.readyState === "ended"))`));

  // ----- EC-001: cách hỏi đổi ở lượt sau, chỗ trống {name} -----
  await learnerB.go(lesson(1));
  await l.see("Bước 1/5", 30000);
  const q1 = await learnerB.evaluate(`document.querySelector("main p[class*=en]")?.textContent`);
  await learnerB.go(lesson(1));
  await l.see("Bước 1/5", 30000);
  const q2 = await learnerB.evaluate(`document.querySelector("main p[class*=en]")?.textContent`);
  check("học lại: cách hỏi khác", !!q1 && !!q2 && q1 !== q2, `${q1} | ${q2}`);
  await l.press("Cách hỏi khác");
  check("nút Cách hỏi khác đổi câu", await l.waitFor(async () => (await learnerB.evaluate(`document.querySelector("main p[class*=en]")?.textContent`)) === q1));
  for (let i = 0; i < 3; i++) {
    if (i === 1) { await l.press("Tên và quá trình học tập của bạn"); }
    await l.press("Tiếp theo →");
  }
  check("EC-001 câu đầu: nhãn chưa điền", await l.see("chưa điền: Họ và tên"));
  await l.press("Nghe");
  check("không đọc nguyên {name}", await l.waitFor(() => learnerB.evaluate(`(() => { const s = window.__spoken.at(-1)?.text ?? ""; return s === "My name is." && !s.includes("{"); })()`)));
  await l.press("Ghi âm");
  await sleep(1000);
  await l.press("Dừng ghi âm");
  await l.see("Nghe giọng mình");
  const oldKeys = (await queue()).recordings.filter((k) => k.startsWith("EC-001|L1|first|"));
  await l.press("Điền thông tin");
  await learnerB.evaluate(`(() => {
    const field = [...document.querySelectorAll("label")].find((x) => x.textContent.trim().startsWith("Họ và tên"));
    const el = field.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Nam");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await l.press("Lưu thông tin");
  check("điền tên → câu có tên, bản thu cũ không còn hiện", await l.see("My name is Nam.") && await l.waitFor(async () => !(await l.text()).includes("Nghe giọng mình")));
  await learnerB.go(lesson(1));
  await l.see("Bước", 30000);
  check("mở lại: bản thu của chữ cũ đã xóa", oldKeys.length === 1 && await l.waitFor(async () => !(await queue()).recordings.includes(oldKeys[0])), JSON.stringify(oldKeys));
  await learnerB.shot(`${OUT}/ec001-ten-360.png`);

  // ----- Micro bị từ chối (Chrome có micro giả luôn cho phép: giả lập lời từ chối của trình duyệt) -----
  await learnerB.go(lesson(3));
  await learnerB.evaluate(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"))`);
  await l.see("Bước", 30000);
  for (let i = 0; i < 3; i++) {
    if (i === 1) await l.press("Động lực đi làm trên tàu");
    await l.press("Tiếp theo →");
  }
  await l.press("Ghi âm");
  check("micro bị từ chối: báo rõ, không kẹt ở Đang ghi âm, vẫn nghe được", await l.see("Bạn chưa cho trang này dùng micro")
    && !(await l.text()).includes("Đang ghi âm") && await l.see("Ghi âm") && await l.see("Nghe"));
  await l.press("Nghe");
  check("micro bị từ chối: nút Nghe vẫn đọc mẫu", await l.waitFor(() => learnerB.evaluate(`window.__spoken.at(-1)?.text === "I want to improve my technical skills."`)));
  await learnerB.shot(`${OUT}/mic-tu-choi-360.png`);

  // ----- Mất mạng -----
  await learnerB.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await learnerB.go(lesson(2));
  check("mất mạng: mở lại bài đã tải", await l.see("I like machinery.", 30000) || await l.see("Bước", 5000), (await l.text()).slice(0, 300));
  await learnerB.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check("không lỗi trang", learnerB.events.errors.filter((e) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|net::/.test(e)).length === 0, JSON.stringify(learnerB.events.errors.slice(0, 5)));
} catch (error) {
  check("chạy hết kịch bản", false, String(error?.stack ?? error));
} finally {
  admin.close();
  learnerB.close();
  // Trả DB dev về như cũ (giữ khóa nháp mới): học viên thử, quyền học, quản trị viên thử.
  for (const id of created.users.filter(Boolean)) {
    const tables = (await db.query(`SELECT table_name FROM information_schema.columns WHERE column_name = 'user_id' AND table_schema = current_schema() AND table_name <> 'users'`)).rows.map((r) => r.table_name);
    for (let pass = 0; pass < 3; pass++) for (const t of tables) await db.query(`DELETE FROM ${t} WHERE user_id = $1`, [id]).catch(() => undefined);
    // Quyền học không xóa được (bảng chỉ ghi thêm): thu hồi.
    await db.query(`UPDATE enrollments SET revoked_at = now(), revoked_reason = 'Kết thúc kiểm thử e2e luyện phỏng vấn' WHERE user_id = $1 AND revoked_at IS NULL`, [id]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id = $1`, [id]).catch((e) => console.log("học viên thử còn lại (nhật ký học chỉ ghi thêm), đã gỡ quyền học, phiên, thiết bị:", e.message));
  }
  if (created.admin) {
    await db.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [created.admin]).catch(() => undefined);
    await db.query(`DELETE FROM admin_login_tokens WHERE admin_user_id = $1`, [created.admin]).catch(() => undefined);
    await db.query(`DELETE FROM admin_users WHERE id = $1`, [created.admin]).catch(async (e) => {
      console.log("quản trị viên thử không xóa được (bảng chỉ ghi thêm), chuyển sang đã thu hồi:", e.message);
      await db.query(`UPDATE admin_users SET status = 'revoked' WHERE id = $1`, [created.admin]).catch((e2) => console.log("  không thu hồi được:", e2.message));
    });
  }
  await db.end();
  console.log(failures.length ? `\n${failures.length} điểm lỗi` : "\nĐạt hết");
  process.exit(failures.length ? 1 : 0);
}
