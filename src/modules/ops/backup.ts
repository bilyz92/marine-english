import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { withFence, type Lease } from "@/modules/jobs/lease";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import type { RunTool, Step } from "./run-tool";

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
export type BackupStats = { name: string; dbBytes: number; mediaNew: number; mediaTotal: number; pruned: number; offsite: boolean; missingKeys: string[] };

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
      "SELECT sha256, visibility, storage_key FROM media_assets ORDER BY sha256");
    // pg_dump nối thẳng vào gpg: bản dump chưa mã hóa không bao giờ nằm trên đĩa.
    await run([{ cmd: "pg_dump", args: ["--format=custom", `--snapshot=${snapshot}`, "--no-password"], env: pgEnv(config.databaseUrl) }, encrypt(keyFile, "-", output)], { signal });
    await client.query("COMMIT");
    return { counts, migration, assets };
  } finally {
    await client.end();
  }
}

function readManifests(dbDir: string): Manifest[] {
  if (!existsSync(dbDir)) return [];
  return readdirSync(dbDir).filter((n) => existsSync(join(dbDir, n, "manifest.json")))
    .map((n) => JSON.parse(readFileSync(join(dbDir, n, "manifest.json"), "utf8")) as Manifest);
}

/** Bỏ bản quá 30 ngày (không bao giờ bỏ bản mới nhất), rồi bỏ tệp media không manifest nào còn trỏ tới. */
function prune(config: BackupConfig, now: Date): number {
  const dbDir = join(config.dir, "db");
  const manifests = readManifests(dbDir).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const newest = manifests.at(-1);
  const expired = manifests.filter((m) => m !== newest && now.getTime() - Date.parse(m.createdAt) > RETENTION_MS);
  for (const m of expired) rmSync(join(dbDir, m.name), { recursive: true, force: true });
  const referenced = new Set(manifests.filter((m) => !expired.includes(m)).flatMap((m) => m.media.map((x) => blobName(x.sha256, x.kid))));
  const store = join(config.dir, "media-store");
  for (const file of readdirSync(store)) if (!file.startsWith(".") && !referenced.has(file)) rmSync(join(store, file));
  return expired.length;
}

/** Đẩy ra ngoài: media trước, rồi bản dump, kiểm, cuối cùng mới ghi COMPLETE; sau đó đồng bộ để dọn bản cũ ở ngoài. */
async function pushOffsite(config: BackupConfig, name: string, run: RunTool, signal: AbortSignal) {
  const remote = config.remote!;
  const local = join(config.dir, "db", name);
  const rclone = (...args: string[]): Step[] => [{ cmd: "rclone", args }];
  await run(rclone("copy", join(config.dir, "media-store"), `${remote}/media-store`), { signal });
  await run(rclone("copy", local, `${remote}/db/${name}`), { signal });
  await run(rclone("check", "--one-way", local, `${remote}/db/${name}`), { signal });
  const complete = join(local, "COMPLETE");
  writeFileSync(complete, createHash("sha256").update(readFileSync(join(local, "manifest.json"))).digest("hex"));
  await run(rclone("copyto", complete, `${remote}/db/${name}/COMPLETE`), { signal });
  await run(rclone("sync", join(config.dir, "db"), `${remote}/db`), { signal });
  await run(rclone("sync", join(config.dir, "media-store"), `${remote}/media-store`), { signal });
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
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Chỉ công bố và dọn khi còn giữ lease: lần chạy đã mất lease không được đụng tới bộ sao lưu.
    const pruned = await withFence(lease, async () => {
      renameSync(tmp, join(config.dir, "db", name));
      return prune(config, now);
    });
    if (config.remote) await pushOffsite(config, name, run, signal);
    // Khóa của mọi bản còn giữ phải còn: mất khóa là mất bản sao lưu đó.
    const kids = new Set(readManifests(join(config.dir, "db")).flatMap((m) => [m.kid, ...m.media.map((x) => x.kid)]));
    const missingKeys = [...kids].filter((kid) => !existsSync(join(config.keysDir, kid))).sort();
    return { name, dbBytes: manifest.dump.bytes, mediaNew, mediaTotal: media.length, pruned, offsite: Boolean(config.remote), missingKeys };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    for (const file of existsSync(store) ? readdirSync(store) : []) if (file.startsWith(".tmp-")) rmSync(join(store, file), { force: true });
  }
}

/** Cảnh báo vận hành về sao lưu, mỗi lý do một tin mỗi ngày (giờ Việt Nam). */
export async function backupAlerts(state: { offsite?: boolean; notConfigured?: boolean; missingKeys?: string[] }, now = new Date()) {
  const day = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  const reasons: { reason: string; keys?: string[] }[] = [];
  if (state.notConfigured) reasons.push({ reason: "not_configured" });
  if (state.offsite === false) reasons.push({ reason: "no_offsite" });
  if (state.missingKeys?.length) reasons.push({ reason: "missing_key", keys: state.missingKeys });
  await withTx(async (tx) => {
    for (const r of reasons) {
      await enqueueOutbox(tx, { dedupKey: `backup_alert:${r.reason}:${day}`, kind: "backup_alert", channel: "telegram", payload: { ...r, day } });
    }
  });
}
