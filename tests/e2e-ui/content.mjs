// Chủ nhập nội dung trên giao diện quản trị. node tests/e2e-ui/content.mjs <địa chỉ gốc> <thư mục ảnh>
// Cần MIGRATOR_DATABASE_URL (tạo tài khoản thử); máy chủ chạy bản dev (lấy link đăng nhập từ hộp thư giả).
// Dùng docs/Engine_Cadet_Three_Levels_v6/nguon/*.docx, docs/Oiler_…/Oiler_Learning_Data_v1.json; docs/07_Oiler.zip nếu có.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import pg from "pg";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [BASE, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await openBrowser({ port: 9446 });
const failures = [];
const check = (name, ok, extra = "") => { console.log(ok ? "✓" : "✗", name, ok ? "" : extra); if (!ok) failures.push(name); };
const text = () => b.evaluate(`document.body?.innerText ?? ""`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const see = (s, ms) => waitFor(async () => (await text()).includes(s), ms);
const click = async (label) => { const ok = await waitFor(() => b.evaluate(`(() => { const el = [...document.querySelectorAll("button,a")].find((e) => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); if (!el) return false; el.click(); return true; })()`), 15000); if (!ok) check(`bấm được “${label}”`, false); return ok; };
const hydrated = () => waitFor(() => b.evaluate(`(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`), 30000);

async function chooseFile(path) {
  const { result: { root } } = await b.send("DOM.getDocument", { depth: -1 });
  const { result: { nodeId } } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
  await b.send("DOM.setFileInputFiles", { nodeId, files: [resolve(path)] });
}

async function adminLogin(email) {
  await b.go(`${BASE}/admin/dang-nhap`);
  await hydrated();
  await b.evaluate(`fetch("/api/auth/admin/link/send", { method: "POST", headers: { "content-type": "application/json", origin: location.origin }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) })`);
  await sleep(500);
  const inbox = await b.evaluate(`fetch("/dev/thu").then((r) => r.text())`);
  const link = inbox.slice(inbox.lastIndexOf(email)).match(/href="([^"]+#link=[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!link) throw new Error("không thấy link đăng nhập");
  await b.go("about:blank");
  await b.go(link);
  await hydrated();
  await click("Vào trang quản trị");
  await waitFor(async () => (await b.evaluate("location.pathname")) === "/admin");
}

// Zip lưu thẳng một JSON học liệu + một tệp rác không nén để tổng > 10 MB (kiểm đường tải không qua proxy).
function bigZip(jsonPath) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = [];
  let off = 0;
  for (const [name, raw, method] of [["data.json", readFileSync(jsonPath), 8], ["dem.bin", randomBytes(9 * 1024 * 1024), 0]]) {
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(method, 8); l.writeUInt32LE(crc(raw), 14); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc(raw), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(l, n, body); central.push(c, n); off += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(2, 8); e.writeUInt16LE(2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const path = join(mkdtempSync(join(tmpdir(), "me-zip-")), "goi-lon.zip");
  writeFileSync(path, Buffer.concat([...parts, cd, e]));
  return path;
}

const stamp = Date.now();
const ownerEmail = `chu${stamp}@x.vn`;
const supportEmail = `hotro${stamp}@x.vn`;
const db = new pg.Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
await db.connect();
for (const [email, role] of [[ownerEmail, "owner"], [supportEmail, "support"]]) {
  await db.query(`INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at) VALUES ($1, $2, 'active', now(), now() + interval '7 days', now())`, [email, role]);
}

try {
  await b.width(1280);
  await adminLogin(ownerEmail);
  check("menu của chủ có Nhập nội dung", await see("Nhập nội dung"));
  await click("Nhập nội dung");
  await see("Tệp nội dung");
  await hydrated();

  // Word: một khóa ngân hàng câu hỏi.
  await chooseFile("docs/Engine_Cadet_Three_Levels_v6/nguon/Engine_Cadet_02_Dry_Cargo_EN.docx");
  await click("Xem trước");
  check("xem trước Word: 59 bài", await see("engine_cadet_02_dry_cargo_en · 59 bài"));
  await b.shot(`${OUT}/noi-dung-xem-truoc-word.png`);
  if ((await text()).includes("Nhập vào hệ thống")) {
    await click("Nhập vào hệ thống");
    check("nhập Word xong", await see("Đã nhập 1 khóa"));
  }
  await chooseFile("docs/Engine_Cadet_Three_Levels_v6/nguon/Engine_Cadet_02_Dry_Cargo_EN.docx");
  await click("Xem trước");
  check("nhập lại: không có gì mới", await see("Không có gì mới để nhập"));
  const row = await db.query(`SELECT status FROM courses WHERE slug = 'engine_cadet_02_dry_cargo_en'`);
  check("khóa từ Word ở dạng nháp hoặc đã có sẵn", ["draft", "published", "archived"].includes(row.rows[0]?.status) && row.rows.length === 1);

  // Gói thật (nếu có) và gói > 10 MB đi thẳng tới handler.
  if (existsSync("docs/07_Oiler.zip")) {
    await chooseFile("docs/07_Oiler.zip");
    await click("Xem trước");
    check("gói Oiler: 3 khóa", await see("oiler_container · 95 bài", 60000));
    await b.shot(`${OUT}/noi-dung-xem-truoc-oiler.png`);
  }
  await chooseFile(bigZip("docs/Wiper_Bilingual_Three_Levels_v1/Wiper_Learning_Data_v1.json"));
  await click("Xem trước");
  check("gói 12 MB qua được (không bị proxy chặn)", await see("wiper_container · 82 bài", 60000), (await text()).slice(-300));

  await b.width(360, 800);
  const problems = await b.evaluate(PAGE_CHECKS);
  check("điện thoại không tràn, ô có nhãn", problems.length === 0, JSON.stringify(problems));
  await b.shot(`${OUT}/noi-dung-360.png`);

  // Hỗ trợ: không có mục, mở thẳng thì báo không có quyền.
  await b.width(1280);
  await b.evaluate(`fetch("/api/auth/admin/logout", { method: "POST", headers: { origin: location.origin, "x-csrf-token": document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_admin="))?.split("=")[1] ?? "" } })`);
  await adminLogin(supportEmail);
  check("menu hỗ trợ không có Nhập nội dung", (await see("Học viên")) && !(await text()).includes("Nhập nội dung"));
  await b.go(`${BASE}/admin/noi-dung`);
  await hydrated();
  check("hỗ trợ mở thẳng → không có quyền", await see("Chỉ chủ tài khoản được nhập nội dung"));
  check("không lỗi trang", b.events.errors.length === 0, b.events.errors.slice(0, 3).join(" | "));
} finally {
  await db.end();
  b.close();
}
console.log(failures.length ? `KHÔNG ĐẠT: ${failures.join("; ")}` : "ĐẠT");
process.exit(failures.length ? 1 : 0);
