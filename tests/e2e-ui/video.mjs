// Bài video (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 6).
// node tests/e2e-ui/video.mjs <địa chỉ gốc> <thư mục ảnh>. Chạy với bản build thật (`pnpm build` rồi `next start`): bản dev không mở lại
// được trang /hoc khi mất mạng. Cần ffmpeg, MIGRATOR_DATABASE_URL và biến môi trường của CLI (SESSION_KEY_ADMIN, APP_ORIGIN) để in link
// đăng nhập admin. Mỗi IP chỉ đăng ký được 5 tài khoản mỗi giờ: chạy lại nhiều lần thì xóa password_attempts trên DB dev trước.
import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
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
const SLUG = `video_${stamp}`;
const YT_TRIAL = "dQw4w9WgXcQ";
const YT_PAID = "aBcDeFgHi_k";
const PAID_TITLE = "Purifier overhaul step by step";

// Tệp mp4 H.264 thật (3 giây) do ffmpeg dựng, thêm một hộp `free` 11 MB ở cuối (hộp cấp đỉnh sau mdat không làm lệch vị trí dữ liệu):
// tệp > 10 MB chứng minh route tải lên không đi qua proxy (proxy đệm thân, giới hạn 10 MB).
// Hai tệp khác nội dung: tệp giống nhau dùng chung một media_asset, mà tệp của bài học thử thì học viên nào cũng tải được.
function makeMp4(name, source) {
  const file = resolve(OUT, name);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `${source}=size=320x180:rate=15`, "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-brand", "isom", file]);
  const pad = 11 * 1024 * 1024;
  const box = Buffer.alloc(pad);
  box.writeUInt32BE(pad, 0);
  box.write("free", 4, "latin1");
  appendFileSync(file, box);
  return file;
}
const MP4 = makeMp4("bai-video-hoc-thu.mp4", "testsrc");
const MP4_PAID = makeMp4("bai-video-tra-phi.mp4", "testsrc2");
const MP4_BYTES = statSync(MP4).size;
const PAID_BYTES = statSync(MP4_PAID).size;

function helpers(b) {
  const text = () => b.evaluate(`document.body?.innerText ?? ""`).catch(() => "");
  const waitFor = async (fn, ms = 120000) => { for (let i = 0; i < ms / 250; i++) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
  const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
  const press = (label, ms = 30000) => waitFor(() => b.evaluate(`(() => {
    const el = [...document.querySelectorAll("main button")].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)}) && !e.disabled);
    if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
    el.click();
    return true;
  })()`), ms);
  /** Phần tử video đầu tiên đã đọc được thông tin (readyState ≥ 1); trả src và thời lượng. */
  const video = () => b.evaluate(`(() => { const v = document.querySelector("main video"); return v && v.readyState >= 1 ? { src: v.currentSrc, duration: v.duration } : null; })()`);
  return { text, waitFor, see, press, video };
}
/** Gọi API trong trang (cookie và CSRF của khu vực đó). */
const api = (b, realm, method, path, body) => b.evaluate(`(async () => {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_${realm}="))?.split("=")[1];
  const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} });
  return { status: r.status, body: await r.json().catch(() => null) };
})()`);
const rangeFetch = (b, path, range) => b.evaluate(`fetch(${JSON.stringify(path)}, { headers: { range: ${JSON.stringify(range)} } })
  .then(async (r) => ({ status: r.status, range: r.headers.get("content-range"), bytes: (await r.arrayBuffer()).byteLength }))`);
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
const offline = (b, on) => b.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

const admin = await openBrowser({ port: 9493 });
const a = helpers(admin);
let videoId = null;
try {
  const ownerEmail = `chu-video${stamp}@x.vn`;
  await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1,'owner','active',now(),now()+interval '7 days',now())`, [ownerEmail]);
  await admin.width(1280, 900);
  await admin.go(`${BASE}/admin/dang-nhap`);
  await a.waitFor(() => admin.evaluate(`Object.keys(document.querySelector("button") ?? {}).some((k) => k.startsWith("__react"))`));
  const link = execSync(`pnpm -s cli admin:login-link ${ownerEmail}`, { env: process.env }).toString().match(/https?:\S+/)?.[0];
  await admin.go("about:blank");
  await admin.go(link);
  await a.press("Vào trang quản trị");
  check("chủ đăng nhập", await a.waitFor(async () => (await admin.evaluate("location.pathname")) === "/admin"));
  check("tạo khóa", (await api(admin, "admin", "POST", "/api/quan-tri/content/courses", { slug: SLUG, titleVi: "Khóa video thử", titleEn: "Video test course" })).status === 200);
  const { rows: [course] } = await db.query(`SELECT id FROM courses WHERE slug = $1`, [SLUG]);

  // Bài 1 video (tệp, học thử), 2 video YouTube (học thử), 3 hỏi–đáp (học thử), 4 video có tệp + YouTube (trả phí).
  const lessons = [
    { lessonType: "video", questionEn: "Engine room tour", youtubeUrl: "" },
    { lessonType: "video", questionEn: "Starting the generator", youtubeUrl: `https://youtu.be/${YT_TRIAL}` },
    { lessonType: "qa", questionEn: "What is a marine diesel engine?", youtubeUrl: "" },
    { lessonType: "video", questionEn: PAID_TITLE, youtubeUrl: `https://www.youtube.com/watch?v=${YT_PAID}` },
  ];
  for (const l of lessons) {
    const { rows: [{ v }] } = await db.query(`SELECT current_version_id::text AS v FROM courses WHERE id = $1`, [course.id]);
    const r = await api(admin, "admin", "POST", `/api/quan-tri/content/courses/${SLUG}/lessons`, {
      expectedVersionId: v, questionVi: "", keyPoints: [{ en: "Check the alarms", vi: "Kiểm tra báo động" }], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [], ...l,
    });
    check(`thêm bài ${l.lessonType} “${l.questionEn}”`, r.status === 200, JSON.stringify(r));
  }

  // Quản trị: form có loại Video, ô link YouTube, không có đáp án mẫu; dòng bài báo "chưa có video"; tải tệp qua nút Video.
  await admin.go(`${BASE}/admin/khoa-hoc/${SLUG}`);
  check("quản trị: bài 1 báo chưa có video", await a.see(`${SLUG}-b1 · Video · học thử · chưa có video`));
  const pressRow = (externalId, label) => a.waitFor(() => admin.evaluate(`(() => {
    const row = [...document.querySelectorAll("main div")].find((d) => d.firstElementChild?.textContent.includes(${JSON.stringify(`${externalId} · `)}));
    const el = row && [...row.querySelectorAll("button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)});
    if (!el || !Object.keys(el).some((k) => k.startsWith("__reactProps"))) return false;
    el.click();
    return true;
  })()`), 30000);
  check("quản trị: mở form sửa bài video", await pressRow(`${SLUG}-b1`, "Sửa") && await a.see("Link YouTube (không bắt buộc nếu tải tệp video lên)", 15000));
  check("quản trị: bài video không có ô đáp án mẫu", !(await a.text()).includes("Đáp án mẫu · tiếng Anh"));
  check("quản trị: nhãn Tiêu đề video", (await a.text()).includes("Tiêu đề video · tiếng Anh"));
  await a.press("Hủy");
  async function uploadVia(externalId, file) {
    await pressRow(externalId, "Video");
    await a.see("Bài chưa có tệp video.", 15000);
    const { result: { root } } = await admin.send("DOM.getDocument", { depth: -1 });
    const { result: { nodeId } } = await admin.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type=file][accept^="video/"]' });
    await admin.send("DOM.setFileInputFiles", { nodeId, files: [file] });
    await a.press("Tải video lên");
    return a.see("Đã tải lên. Xem lại video bên dưới", 120000);
  }
  check(`quản trị: tải video ${(MP4_BYTES / 1048576).toFixed(1)} MB (> 10 MB) cho bài 1`, await uploadVia(`${SLUG}-b1`, MP4), (await a.text()).slice(-400));
  check("quản trị: xem lại video vừa tải", await a.waitFor(() => admin.evaluate(`(() => { const v = document.querySelector("main video"); if (v) v.preload = "metadata"; return !!v && v.readyState >= 1 && v.duration > 0; })()`), 30000));
  for (const w of [1280, 360]) {
    await admin.width(w, 900);
    await sleep(300);
    const problems = await admin.evaluate(PAGE_CHECKS);
    check(`quản trị: không lỗi giao diện @${w}`, problems.length === 0, JSON.stringify(problems));
    await admin.shot(`${OUT}/quan-tri-video-${w}.png`);
  }
  await admin.width(1280, 900);
  await pressRow(`${SLUG}-b1`, "Ẩn video");
  check("quản trị: tải video cho bài 4", await uploadVia(`${SLUG}-b4`, MP4_PAID));
  const { rows: [asset] } = await db.query(
    `SELECT ma.id::text AS id, ma.visibility FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
     JOIN lessons l ON l.id = (SELECT lesson_id FROM lesson_versions WHERE id = cvl.lesson_version_id)
     JOIN lesson_version_assets lva ON lva.lesson_version_id = cvl.lesson_version_id AND lva.role = 'video'
     JOIN media_assets ma ON ma.id = lva.media_asset_id WHERE c.id = $1 AND l.external_id = $2`, [course.id, `${SLUG}-b4`]);
  videoId = asset?.id;
  check("tệp video bài 4 là tệp bảo vệ", asset?.visibility === "protected");
  check("mở bán", (await api(admin, "admin", "PATCH", `/api/quan-tri/courses/${course.id}`, { priceVnd: 99000, status: "published" })).status === 200);

  // Khách: trang khóa không lộ bài 4; học thử bài 1 phát tệp (Range 206), bài 2 nhúng YouTube.
  const g = await openBrowser({ port: 9494 });
  const gh = helpers(g);
  try {
    await g.width(390, 900);
    await g.go(`${BASE}/khoa-hoc`);
    const html = await g.evaluate(`fetch("/khoa-hoc/${SLUG}").then((r) => r.text())`);
    const publicApi = await g.evaluate(`fetch("/api/public/courses/${SLUG}").then((r) => r.text())`);
    for (const [what, s] of [["mã YouTube", YT_PAID], ["mã tệp", videoId], ["tiêu đề", PAID_TITLE]]) {
      check(`trang khóa: HTML không có ${what} bài 4`, html.length > 1000 && !html.includes(s));
      check(`API công khai: không có ${what} bài 4`, !publicApi.includes(s));
    }
    check("khách: /api/learn/files của bài 4 bị chặn", [401, 403].includes((await rangeFetch(g, `/api/learn/files/${videoId}`, "bytes=0-9")).status));
    check("khách: video học thử ở vị trí 4 → 404", (await rangeFetch(g, `/api/public/courses/${SLUG}/trial/4/video`, "bytes=0-9")).status === 404);
    const part = await rangeFetch(g, `/api/public/courses/${SLUG}/trial/1/video`, "bytes=100-199");
    check("khách: video học thử Range 206", part.status === 206 && part.bytes === 100 && part.range === `bytes 100-199/${MP4_BYTES}`, JSON.stringify(part));
    await g.go(`${BASE}/khoa-hoc/${SLUG}/hoc-thu/1`);
    check("học thử bài 1: video phát được", await gh.waitFor(async () => (await gh.video())?.duration > 0, 30000), (await gh.text()).slice(0, 300));
    check("học thử: nhãn Video", (await gh.text()).includes("· Video"));
    check("học thử: không có nút tải về máy", !(await gh.text()).includes("Tải video về máy"));
    const trialProblems = await g.evaluate(PAGE_CHECKS);
    check("học thử: không lỗi giao diện @390", trialProblems.length === 0, JSON.stringify(trialProblems));
    await g.shot(`${OUT}/hoc-thu-video-390.png`);
    await g.go(`${BASE}/khoa-hoc/${SLUG}/hoc-thu/2`);
    check("học thử bài 2: nhúng youtube-nocookie", await gh.waitFor(() => g.evaluate(`document.querySelector("main iframe")?.src === "https://www.youtube-nocookie.com/embed/${YT_TRIAL}"`), 30000));
  } finally {
    g.close();
  }

  // Học viên được cấp: phát bài 4 từ máy chủ, tải khóa và video về máy, mất mạng vẫn xem từ blob:; YouTube khi mất mạng báo cần mạng.
  const l = await openBrowser({ port: 9495 });
  const lh = helpers(l);
  try {
    await l.width(390, 900);
    const userA = await learner(l, "Học viên video");
    check("học viên A", !!userA);
    check("cấp khóa cho A", (await api(admin, "admin", "POST", "/api/quan-tri/grants", { userId: userA, courseId: course.id, reason: "Kiểm thử video" })).status === 201);
    const part = await rangeFetch(l, `/api/learn/files/${videoId}`, "bytes=0-");
    check("A: /api/learn/files Range bytes=0- → 206 đủ tệp", part.status === 206 && part.bytes === PAID_BYTES, JSON.stringify(part));
    await l.go(`${BASE}/hoc?khoa=${SLUG}`);
    check("A: danh sách bài có nhãn Video", await lh.see("Video"));
    await lh.press("Tải khóa về máy");
    // Lúc đang tải, nút được thay bằng thanh tiến độ: chỉ coi là xong khi cả khối "Học khi không có mạng" biến mất.
    check("A tải khóa xong", await lh.waitFor(async () => !(await lh.text()).includes("Học khi không có mạng")));
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=4`);
    check("A: bài 4 phát từ máy chủ", await lh.waitFor(async () => (await lh.video())?.src.includes(`/api/learn/files/${videoId}`) && (await lh.video())?.duration > 0, 60000));
    check("A: có nút tải video kèm dung lượng", await lh.see(`Tải video về máy (${(PAID_BYTES / 1048576).toFixed(1)} MB)`));
    await lh.press("Tải video về máy");
    check("A: đã tải video về máy", await lh.see("Đã tải video về máy", 120000));
    await l.shot(`${OUT}/hoc-vien-video-390.png`);
    const problems = await l.evaluate(PAGE_CHECKS);
    check("A: không lỗi giao diện @390", problems.length === 0, JSON.stringify(problems));
    await offline(l, true);
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=4`);
    check("mất mạng: bài 4 phát từ blob:", await lh.waitFor(async () => (await lh.video())?.src.startsWith("blob:") && (await lh.video())?.duration > 0, 60000), (await lh.text()).slice(0, 400));
    await l.shot(`${OUT}/video-mat-mang.png`);
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=2`);
    check("mất mạng: bài YouTube báo cần mạng", await lh.see("Video YouTube cần có mạng để xem", 60000));
    await offline(l, false);
    await l.go(`${BASE}/hoc?khoa=${SLUG}&bai=4`);
    await lh.see("Đã tải video về máy", 60000);
    await lh.press("Xóa khỏi máy");
    check("A: xóa video khỏi máy", await lh.see("Tải video về máy (", 30000));

    await l.send("Network.clearBrowserCookies");
    const userB = await learner(l, "Học viên không mua");
    check("học viên B", !!userB);
    const denied = await rangeFetch(l, `/api/learn/files/${videoId}`, "bytes=0-9");
    check("B không mua: /api/learn/files → 403", denied.status === 403, JSON.stringify(denied));
    check("không lỗi trang (học viên)", l.events.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(String(e))).length === 0, JSON.stringify(l.events.errors.slice(0, 3)));
  } finally {
    l.close();
  }
} finally {
  admin.close();
  await db.end();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
