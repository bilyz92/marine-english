import { createHash, createHmac, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { withFence, type Lease } from "@/modules/jobs/lease";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import type { RunTool, Step } from "./run-tool";
// Dùng chung bộ kiểm manifest với bước khôi phục (deploy/restore.mjs).
import { validateManifest, verifyManifestMac } from "../../../deploy/manifest-check.mjs";

export type BackupConfig = { databaseUrl: string; dir: string; keysDir: string; keyId: string; remote: string | null; mediaRoot: string };
export type MediaEntry = { sha256: string; kid: string; visibility: "public" | "protected"; storageKey: string };
export type Manifest = {
  version: 1;
  name: string;
  createdAt: string;
  kid: string;
  dump: { file: string; bytes: number; sha256: string };
  migration: string | null;
  counts: Record<string, number>;
  media: MediaEntry[];
};
export type BackupStats = { name: string; dbBytes: number; mediaNew: number; mediaTotal: number; pruned: number; pruneSkipped: boolean; offsite: boolean; offsiteError?: string; missingKeys: string[] };

const RETENTION_MS = 30 * 86_400_000;
const COUNTED = ["orders", "bank_transactions", "enrollments"] as const;

export function backupConfig(): BackupConfig | null {
  const e = env();
  if (!e.BACKUP_DATABASE_URL || !e.BACKUP_DIR || !e.BACKUP_KEYS_DIR || !e.BACKUP_KEY_ID) return null;
  return { databaseUrl: e.BACKUP_DATABASE_URL, dir: e.BACKUP_DIR, keysDir: e.BACKUP_KEYS_DIR, keyId: e.BACKUP_KEY_ID, remote: e.BACKUP_RCLONE_REMOTE ?? null, mediaRoot: e.MEDIA_ROOT };
}

/** Thông tin kết nối qua biến môi trường của libpq: mật khẩu không bao giờ nằm trong tham số dòng lệnh. */
function pgEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  const vars: Record<string, string> = {
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1),
  };
  const options = u.searchParams.get("options");
  if (options) vars.PGOPTIONS = options;
  return vars;
}

const sha256File = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(path).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
});
const encrypt = (keyFile: string, input: string, output: string): Step =>
  ({ cmd: "gpg", args: ["--batch", "--yes", "--quiet", "--symmetric", "--cipher-algo", "AES256", "--passphrase-file", keyFile, "-o", output, input] });
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const blobName = (sha: string, kid: string) => `${sha}.${kid}.gpg`;

/** Đọc số liệu đối chiếu và danh sách media trong cùng snapshot với pg_dump, để manifest khớp đúng bản dump. */
async function dumpDatabase(config: BackupConfig, keyFile: string, output: string, run: RunTool, signal: AbortSignal) {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [{ snapshot }] } = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
    const counts: Record<string, number> = {};
    for (const table of COUNTED) counts[table] = Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    const hasMigrations = (await client.query("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS ok")).rows[0].ok as boolean;
    const migration = hasMigrations
      ? ((await client.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")).rows[0]?.migration_name ?? null)
      : null;
    const { rows: assets } = await client.query<{ sha256: string; visibility: "public" | "protected"; storage_key: string }>(
      // Ảnh chứng minh chuyển khoản (D4) cũng là tệp được bảo vệ dưới MEDIA_ROOT: sao lưu cùng media bài học.
      `SELECT DISTINCT ON (visibility, storage_key) sha256, visibility, storage_key FROM (
         SELECT sha256, visibility, storage_key FROM media_assets
         UNION ALL SELECT sha256, 'protected', storage_key FROM transfer_proofs
       ) f ORDER BY visibility, storage_key`);
    // pg_dump nối thẳng vào gpg: bản dump chưa mã hóa không bao giờ nằm trên đĩa.
    await run([{ cmd: "pg_dump", args: ["--format=custom", `--snapshot=${snapshot}`, "--no-password"], env: pgEnv(config.databaseUrl) }, encrypt(keyFile, "-", output)], { signal });
    await client.query("COMMIT");
    return { counts, migration, assets };
  } finally {
    await client.end();
  }
}

const SET_NAME = /^\d{8}-\d{6}$/;

/**
 * Các bản sao lưu trong db/. Một bản chỉ được tin khi: tên thư mục dạng thời điểm, manifest qua bộ kiểm định dạng của bước
 * khôi phục, tên trong manifest đúng tên thư mục, và manifest.mac khớp theo khóa sao lưu của nó. Hỏng chỗ nào thì vào `suspect`:
 * không biết bản ấy cần tệp media nào nên không được dọn gì cả. Xóa luôn theo tên thư mục thật.
 */
function readManifests(dbDir: string, keysDir: string): { sets: Manifest[]; suspect: string[]; missingKeys: Set<string> } {
  const result = { sets: [] as Manifest[], suspect: [] as string[], missingKeys: new Set<string>() };
  if (!existsSync(dbDir)) return result;
  for (const dir of readdirSync(dbDir)) {
    if (!SET_NAME.test(dir)) continue;
    try {
      const raw = readFileSync(join(dbDir, dir, "manifest.json"));
      const m = validateManifest(JSON.parse(raw.toString("utf8"))) as Manifest;
      for (const kid of new Set([m.kid, ...m.media.map((x) => x.kid)])) if (!existsSync(join(keysDir, kid))) result.missingKeys.add(kid);
      const mac = readFileSync(join(dbDir, dir, "manifest.mac"), "utf8");
      if (m.name !== dir || !verifyManifestMac(raw, mac, readFileSync(join(keysDir, m.kid)))) throw new Error("manifest_untrusted");
      result.sets.push(m);
    } catch {
      result.suspect.push(dir);
    }
  }
  return result;
}

/** Bỏ bản quá 30 ngày (không bao giờ bỏ bản mới nhất), rồi bỏ tệp media không manifest nào còn trỏ tới. */
function prune(config: BackupConfig, now: Date): { pruned: number; pruneSkipped: boolean } {
  const dbDir = join(config.dir, "db");
  const { sets, suspect } = readManifests(dbDir, config.keysDir);
  // Một bản không đọc được manifest: không biết nó cần tệp media nào, dọn sẽ có thể làm hỏng nó. Ngừng hẳn và cảnh báo.
  if (suspect.length > 0) return { pruned: 0, pruneSkipped: true };
  const manifests = sets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const newest = manifests.at(-1);
  const expired = manifests.filter((m) => m !== newest && now.getTime() - Date.parse(m.createdAt) > RETENTION_MS);
  for (const m of expired) rmSync(join(dbDir, m.name), { recursive: true, force: true });
  const referenced = new Set(manifests.filter((m) => !expired.includes(m)).flatMap((m) => m.media.map((x) => blobName(x.sha256, x.kid))));
  const store = join(config.dir, "media-store");
  for (const file of readdirSync(store)) if (!file.startsWith(".") && !referenced.has(file)) rmSync(join(store, file));
  return { pruned: expired.length, pruneSkipped: false };
}

/** "20261031-023000" (UTC) → thời điểm. */
const nameTime = (name: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null;
};

/**
 * Đẩy ra ngoài: media trước, rồi bản dump, kiểm, cuối cùng mới ghi COMPLETE. Nơi lưu ngoài dọn theo tuổi của chính nó, không sao y
 * thư mục cục bộ: máy chủ mới với volume trống hay xóa nhầm ở máy chủ không được lan ra bản ở ngoài. Kho media ở ngoài chỉ thêm.
 */
async function pushOffsite(config: BackupConfig, name: string, now: Date, run: RunTool, signal: AbortSignal) {
  const remote = config.remote!;
  const local = join(config.dir, "db", name);
  const rclone = (...args: string[]): Step[] => [{ cmd: "rclone", args }];
  await run(rclone("copy", join(config.dir, "media-store"), `${remote}/media-store`), { signal });
  await run(rclone("copy", local, `${remote}/db/${name}`), { signal });
  await run(rclone("check", "--one-way", local, `${remote}/db/${name}`), { signal });
  const complete = join(local, "COMPLETE");
  writeFileSync(complete, createHash("sha256").update(readFileSync(join(local, "manifest.json"))).digest("hex"));
  await run(rclone("copyto", complete, `${remote}/db/${name}/COMPLETE`), { signal });
  // Bản vừa đẩy là bản COMPLETE mới nhất: chỉ sau khi có nó mới dọn, và không bao giờ dọn nó.
  const listing = join(config.dir, ".tmp", `remote-${randomBytes(6).toString("hex")}`);
  mkdirSync(join(config.dir, ".tmp"), { recursive: true, mode: 0o700 });
  try {
    await run(rclone("lsf", "--dirs-only", `${remote}/db`), { signal, stdoutFile: listing });
    const remoteSets = readFileSync(listing, "utf8").split("\n").map((l) => l.trim().replace(/\/$/, "")).filter(Boolean);
    for (const set of remoteSets) {
      const at = nameTime(set);
      if (set !== name && at !== null && now.getTime() - at > RETENTION_MS) await run(rclone("purge", `${remote}/db/${set}`), { signal });
    }
  } finally {
    rmSync(listing, { force: true });
  }
}

export async function backup(input: { config: BackupConfig; run: RunTool; lease: Lease; signal: AbortSignal; now: Date }): Promise<BackupStats> {
  const { config, run, lease, signal, now } = input;
  const keyFile = join(config.keysDir, config.keyId);
  if (!existsSync(keyFile)) throw new Error(`backup_key_missing:${config.keyId}`);
  const store = join(config.dir, "media-store");
  const tmpRoot = join(config.dir, ".tmp");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  mkdirSync(join(config.dir, "db"), { recursive: true, mode: 0o700 });
  // Đang giữ lease nên thư mục tạm còn lại là của lần chạy đã chết.
  rmSync(tmpRoot, { recursive: true, force: true });
  const tmp = join(tmpRoot, randomBytes(8).toString("hex"));
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const name = stamp(now);
  // Chỉ dọn tệp dở của chính lần chạy này: lần chạy cũ mất lease không được xóa tệp của lần chạy mới.
  const partials = new Set<string>();
  try {
    const dumpPath = join(tmp, "db.dump.gpg");
    const { counts, migration, assets } = await dumpDatabase(config, keyFile, dumpPath, run, signal);
    // Media chép sau DB: tệp media chỉ thêm, nên mọi tệp bản dump trỏ tới đều đã có trên đĩa.
    let mediaNew = 0;
    const media: MediaEntry[] = [];
    for (const asset of assets) {
      signal.throwIfAborted();
      const blob = join(store, blobName(asset.sha256, config.keyId));
      if (!existsSync(blob)) {
        const source = join(config.mediaRoot, asset.visibility, asset.storage_key);
        if (!existsSync(source)) throw new Error(`media_missing:${asset.storage_key}`);
        if ((await sha256File(source)) !== asset.sha256) throw new Error(`media_mismatch:${asset.storage_key}`);
        const partial = join(store, `.tmp-${randomBytes(6).toString("hex")}`);
        partials.add(partial);
        await run([encrypt(keyFile, source, partial)], { signal });
        renameSync(partial, blob);
        mediaNew++;
      }
      media.push({ sha256: asset.sha256, kid: config.keyId, visibility: asset.visibility, storageKey: asset.storage_key });
    }
    const manifest: Manifest = {
      version: 1, name, createdAt: now.toISOString(), kid: config.keyId,
      dump: { file: "db.dump.gpg", bytes: statSync(dumpPath).size, sha256: await sha256File(dumpPath) },
      migration, counts, media,
    };
    const manifestRaw = Buffer.from(JSON.stringify(manifest, null, 2));
    writeFileSync(join(tmp, "manifest.json"), manifestRaw, { mode: 0o600 });
    // MAC theo khóa sao lưu: ai sửa được bản ở nơi lưu ngoài cũng không giả được manifest (khôi phục kiểm trước khi dùng).
    writeFileSync(join(tmp, "manifest.mac"), createHmac("sha256", readFileSync(keyFile)).update(manifestRaw).digest("hex"), { mode: 0o600 });
    // Chỉ công bố và dọn khi còn giữ lease: lần chạy đã mất lease không được đụng tới bộ sao lưu.
    // Dọn nhiều tệp (sau khi đổi khóa) có thể lâu hơn hạn mặc định 5 giây của transaction.
    const { pruned, pruneSkipped } = await withFence(lease, async () => {
      renameSync(tmp, join(config.dir, "db", name));
      return prune(config, now);
    }, { txTimeoutMs: 120_000 });
    // Bản cục bộ đã an toàn: lỗi đẩy ra ngoài chỉ cảnh báo, không chạy lại cả bản dump mỗi 5 phút.
    let offsiteError: string | undefined;
    if (config.remote) {
      try {
        await pushOffsite(config, name, now, run, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        offsiteError = error instanceof Error ? error.message : String(error);
      }
    }
    // Khóa của mọi bản còn giữ phải còn: mất khóa là mất bản sao lưu đó.
    const missingKeys = [...readManifests(join(config.dir, "db"), config.keysDir).missingKeys].sort();
    return { name, dbBytes: manifest.dump.bytes, mediaNew, mediaTotal: media.length, pruned, pruneSkipped, offsite: Boolean(config.remote) && !offsiteError, offsiteError, missingKeys };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    for (const partial of partials) rmSync(partial, { force: true });
  }
}

/** Cảnh báo vận hành về sao lưu, mỗi lý do một tin mỗi ngày (giờ Việt Nam). */
export async function backupAlerts(state: { offsite?: boolean; offsiteError?: string; notConfigured?: boolean; missingKeys?: string[]; pruneSkipped?: boolean }, now = new Date()) {
  const day = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  const reasons: { reason: string; keys?: string[]; error?: string }[] = [];
  if (state.notConfigured) reasons.push({ reason: "not_configured" });
  if (state.offsiteError) reasons.push({ reason: "offsite_failed", error: state.offsiteError });
  else if (state.offsite === false) reasons.push({ reason: "no_offsite" });
  if (state.missingKeys?.length) reasons.push({ reason: "missing_key", keys: state.missingKeys });
  if (state.pruneSkipped) reasons.push({ reason: "prune_skipped" });
  await withTx(async (tx) => {
    for (const r of reasons) {
      await enqueueOutbox(tx, { dedupKey: `backup_alert:${r.reason}:${day}`, kind: "backup_alert", channel: "telegram", payload: { ...r, day } });
    }
  });
}
