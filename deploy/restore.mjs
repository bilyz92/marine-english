// Phần lõi khôi phục, chạy trong image worker (có gpg, pg_restore 16, pg). Dùng chung cho restore.sh (khôi phục thật) và restore-drill.sh (thử).
// node deploy/restore.mjs --set <thư mục bản sao lưu> --store <kho media> --keys <thư mục khóa> --media-root <đích media> [--require-complete]
// URL DB qua biến môi trường (mật khẩu không nằm trong tham số): RESTORE_DB_URL (chủ DB, me_migrator), RESTORE_APP_DB_URL (me_app, tùy chọn).
// Lỗi bất kỳ → mã thoát khác 0. DB hoặc thư mục media đích không trống → từ chối.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { COUNT_TABLES, validateManifest, verifyManifestMac } from "./manifest-check.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
for (const required of ["set", "store", "keys", "media-root"]) if (!args[required]) fail(`thiếu --${required}`);
args.db = process.env.RESTORE_DB_URL;
args["app-db"] = process.env.RESTORE_APP_DB_URL;
if (!args.db) fail("thiếu biến RESTORE_DB_URL");

function fail(message) {
  console.error(`KHÔI PHỤC HỎNG: ${message}`);
  process.exit(1);
}
const log = (message) => console.log(`• ${message}`);
const sha256File = (path) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(path).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
});
function pgEnv(url) {
  const u = new URL(url);
  return { PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
}
const exited = (child) => new Promise((resolve) => {
  child.once("error", () => resolve(-1));
  child.once("exit", (code) => resolve(code ?? -1));
});

/** a | b: chờ CẢ HAI tiến trình thoát; lỗi ở bất kỳ bước nào → lỗi. */
async function pipe(first, second) {
  const a = spawn(first.cmd, first.args, { env: { PATH: process.env.PATH, HOME: "/tmp", ...first.env }, stdio: ["ignore", "pipe", "inherit"] });
  const b = spawn(second.cmd, second.args, { env: { PATH: process.env.PATH, HOME: "/tmp", ...second.env }, stdio: [a.stdout, "ignore", "inherit"] });
  a.stdout.destroy();
  const [ca, cb] = await Promise.all([exited(a), exited(b)]);
  if (ca !== 0 || cb !== 0) throw new Error(`${first.cmd}=${ca} ${second.cmd}=${cb}`);
}
function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { env: { PATH: process.env.PATH, HOME: "/tmp" }, stdio: ["ignore", "ignore", "inherit"] });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd}=${c}`))));
  });
}

const setDir = args.set;
const manifestPath = join(setDir, "manifest.json");
if (!existsSync(manifestPath)) fail(`không có ${manifestPath}`);
const manifestRaw = readFileSync(manifestPath);
let manifest;
try {
  manifest = validateManifest(JSON.parse(manifestRaw));
} catch (error) {
  fail(error.message);
}
// Manifest phải ký bằng chính khóa sao lưu: không có khóa thì không giả được, kể cả khi sửa được nơi lưu ngoài.
const macPath = join(setDir, "manifest.mac");
if (!existsSync(macPath)) fail("thiếu manifest.mac");
if (!existsSync(join(args.keys, manifest.kid))) fail(`thiếu tệp khóa ${manifest.kid}`);
if (!verifyManifestMac(manifestRaw, readFileSync(macPath, "utf8"), readFileSync(join(args.keys, manifest.kid)))) fail("manifest.mac không khớp: manifest bị sửa hoặc sai khóa");
log(`bản ${manifest.name}, tạo ${manifest.createdAt}, khóa ${manifest.kid}, migration ${manifest.migration}`);

// 1. Bản sao lưu nguyên vẹn.
if (args["require-complete"] || existsSync(join(setDir, "COMPLETE"))) {
  if (!existsSync(join(setDir, "COMPLETE"))) fail("thiếu COMPLETE: bản đẩy ra ngoài chưa hoàn tất, không dùng để khôi phục");
  const expected = readFileSync(join(setDir, "COMPLETE"), "utf8").trim();
  if (createHash("sha256").update(manifestRaw).digest("hex") !== expected) fail("COMPLETE không khớp manifest");
}
const dumpPath = join(setDir, manifest.dump.file);
if ((await sha256File(dumpPath)) !== manifest.dump.sha256) fail("bản dump sai sha256 (hỏng hoặc bị sửa)");
const keyFor = (kid) => {
  const path = join(args.keys, kid);
  if (!existsSync(path)) fail(`thiếu tệp khóa ${kid}`);
  return path;
};
log("bản dump đúng sha256");

// 2. Đích phải trống.
const db = new pg.Client({ connectionString: args.db });
await db.connect();
const { rows: [{ n: tables }] } = await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
if (tables > 0) fail("DB đích đã có bảng: khôi phục chỉ chạy trên DB trống");
if (existsSync(args["media-root"]) && readdirSync(args["media-root"]).length > 0) fail("thư mục media đích không trống");

// 3. Dữ liệu. Không dùng --no-owner: hàm SECURITY DEFINER phải giữ đúng chủ.
try {
  await pipe(
    { cmd: "gpg", args: ["--batch", "--quiet", "--passphrase-file", keyFor(manifest.kid), "--decrypt", dumpPath] },
    { cmd: "pg_restore", args: ["--exit-on-error", "--no-password", "--dbname", pgEnv(args.db).PGDATABASE], env: pgEnv(args.db) },
  );
} catch (error) {
  fail(`pg_restore: ${error.message}`);
}
for (const table of COUNT_TABLES) {
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  if (n !== manifest.counts[table]) fail(`${table}: ${n} dòng, manifest ghi ${manifest.counts[table]}`);
}
if (manifest.migration) {
  const { rows } = await db.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1");
  if (rows[0]?.migration_name !== manifest.migration) fail(`migration ${rows[0]?.migration_name}, manifest ghi ${manifest.migration}`);
}
log(`dữ liệu khớp: ${JSON.stringify(manifest.counts)}`);

// 4. Media: giải mã từng tệp về đúng chỗ, kiểm sha256; mọi media_assets phải có tệp.
for (const entry of manifest.media) {
  const dir = join(args["media-root"], entry.visibility);
  mkdirSync(dir, { recursive: true });
  const partial = join(dir, `.restore-${entry.sha256}`);
  try {
    await run("gpg", ["--batch", "--quiet", "--yes", "--passphrase-file", keyFor(entry.kid), "--output", partial, "--decrypt", join(args.store, `${entry.sha256}.${entry.kid}.gpg`)]);
  } catch (error) {
    fail(`giải mã ${entry.storageKey}: ${error.message}`);
  }
  if ((await sha256File(partial)) !== entry.sha256) fail(`${entry.storageKey} sai sha256`);
  renameSync(partial, join(dir, entry.storageKey));
}
const { rows: assets } = await db.query("SELECT visibility, storage_key FROM media_assets");
for (const a of assets) if (!existsSync(join(args["media-root"], a.visibility, a.storage_key))) fail(`thiếu tệp cho media_assets ${a.storage_key}`);
log(`media khớp: ${manifest.media.length} tệp`);
await db.end();

// 5. Ứng dụng đọc được bằng vai trò của nó.
if (args["app-db"]) {
  const app = new pg.Client({ connectionString: args["app-db"] });
  await app.connect();
  const { rows: [r] } = await app.query("SELECT (SELECT count(*) FROM courses)::int AS courses, (SELECT count(*) FROM orders)::int AS orders");
  await app.end();
  log(`me_app đọc được: ${r.courses} khóa, ${r.orders} đơn`);
}
console.log("KHÔI PHỤC ĐẠT");
