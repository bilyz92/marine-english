import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { acquireLease, type Lease } from "@/modules/jobs/lease";
import { backup, type BackupConfig, type Manifest } from "@/modules/ops/backup";
import type { RunTool, Step } from "@/modules/ops/run-tool";
import { withSearchPath } from "../helpers/db";
import { sqlAsMigrator } from "../helpers/otp";

const PASSPHRASE = { k1: "mat-khau-sao-luu-k1", k2: "mat-khau-sao-luu-k2" };
let root: string;
let config: BackupConfig;
let calls: Step[][];
let failOn: string | null;

/** Công cụ giả: pg_dump | gpg ghi “bản dump” ra tệp -o; gpg mã hóa tệp đầu vào; rclone chép giữa thư mục cục bộ. */
const fakeRun: RunTool = async (steps) => {
  calls.push(steps);
  const head = steps[0]!;
  const fail = failOn;
  if (fail && steps.some((s) => s.cmd === fail || s.args.includes(fail))) throw new Error(`tool_failed:${fail}:1`);
  const out = (s: Step) => s.args[s.args.indexOf("-o") + 1]!;
  if (head.cmd === "pg_dump") return void writeFileSync(out(steps[1]!), `DUMP:${head.args.join(" ")}`);
  if (head.cmd === "gpg") return void writeFileSync(out(head), `ENC:${readFileSync(head.args.at(-1)!, "utf8")}`);
  if (head.cmd === "rclone") {
    const [op, src, dst] = head.args.filter((a) => !a.startsWith("-"));
    if (op === "copy" || op === "sync") {
      if (op === "sync") rmSync(dst!, { recursive: true, force: true });
      mkdirSync(dst!, { recursive: true });
      cpSync(src!, dst!, { recursive: true });
    } else if (op === "copyto") {
      mkdirSync(dirname(dst!), { recursive: true });
      cpSync(src!, dst!);
    } else if (op === "check") {
      for (const f of readdirSync(src!)) if (!existsSync(join(dst!, f))) throw new Error("tool_failed:rclone:1");
    }
  }
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function media(text: string, visibility: "public" | "protected") {
  const hash = sha(text);
  const key = `${hash}.png`;
  mkdirSync(join(config.mediaRoot, visibility), { recursive: true });
  writeFileSync(join(config.mediaRoot, visibility, key), text);
  await sqlAsMigrator(`INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'image/png', $2, $3, $4)`, [hash, text.length, visibility, key]);
  return hash;
}
const lease = async (): Promise<Lease> => {
  await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second'`);
  return (await acquireLease("me.backup.daily", "w1"))!;
};
const run = async (now = new Date(), cfg = config) => backup({ config: cfg, run: fakeRun, lease: await lease(), signal: new AbortController().signal, now });
const sets = () => (existsSync(join(root, "backups/db")) ? readdirSync(join(root, "backups/db")).sort() : []);
const manifest = (name: string) => JSON.parse(readFileSync(join(root, "backups/db", name, "manifest.json"), "utf8")) as Manifest;
const blobs = () => readdirSync(join(root, "backups/media-store")).sort();
const tmpLeft = () => (existsSync(join(root, "backups/.tmp")) ? readdirSync(join(root, "backups/.tmp")) : []);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "me-backup-"));
  mkdirSync(join(root, "keys"), { mode: 0o700 });
  for (const [kid, pass] of Object.entries(PASSPHRASE)) writeFileSync(join(root, "keys", kid), pass, { mode: 0o600 });
  config = {
    databaseUrl: withSearchPath(process.env.BACKUP_DATABASE_URL!, process.env.TEST_SCHEMA!),
    dir: join(root, "backups"), keysDir: join(root, "keys"), keyId: "k1", remote: null, mediaRoot: join(root, "media"),
  };
  calls = [];
  failOn = null;
});

describe("sao lưu", () => {
  it("tạo bản dump đã mã hóa, kho media và manifest đủ dữ kiện để dựng lại", async () => {
    const pub = await media("anh-cong-khai", "public");
    const prot = await media("anh-tra-phi", "protected");
    await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('A')`);
    const stats = await run();
    expect(stats).toMatchObject({ mediaNew: 2, mediaTotal: 2, offsite: false });
    const [name] = sets();
    const m = manifest(name!);
    expect(m).toMatchObject({ version: 1, kid: "k1", dump: { file: "db.dump.gpg" } });
    expect(m.dump.sha256).toBe(sha(readFileSync(join(root, "backups/db", name!, "db.dump.gpg"), "utf8")));
    expect(m.media.map((x) => [x.sha256, x.kid, x.visibility])).toEqual(expect.arrayContaining([[pub, "k1", "public"], [prot, "k1", "protected"]]));
    expect(m.media.every((x) => x.storageKey.endsWith(".png"))).toBe(true);
    expect(m.counts).toMatchObject({ orders: 0, bank_transactions: 0, enrollments: 0 });
    expect(blobs()).toEqual([`${pub}.k1.gpg`, `${prot}.k1.gpg`].sort());
    const dumpCall = calls.find((c) => c[0]!.cmd === "pg_dump")!;
    expect(dumpCall[0]!.args.some((a) => a.startsWith("--snapshot="))).toBe(true);
    expect(dumpCall[1]!.cmd).toBe("gpg");
    expect(tmpLeft()).toEqual([]);
  });

  it("lần sau không mã hóa lại tệp đã có; hai lần dùng thư mục tạm khác nhau", async () => {
    await media("anh-1", "public");
    await run(new Date("2026-10-30T02:30:00Z"));
    await media("anh-2", "public");
    const output = (args: string[]) => args[args.indexOf("-o") + 1];
    const firstDump = output(calls.find((c) => c[0]!.cmd === "pg_dump")![1]!.args);
    calls = [];
    const stats = await run(new Date("2026-10-31T02:30:00Z"));
    expect(stats).toMatchObject({ mediaNew: 1, mediaTotal: 2 });
    expect(calls.filter((c) => c[0]!.cmd === "gpg")).toHaveLength(1);
    const secondDump = output(calls.find((c) => c[0]!.cmd === "pg_dump")![1]!.args);
    expect(firstDump).not.toBe(secondDump);
    expect(sets()).toHaveLength(2);
  });

  it("mật khẩu không có trong tham số dòng lệnh hay biến môi trường của công cụ, cũng không trong lỗi", async () => {
    await media("anh", "public");
    await run();
    const flat = JSON.stringify(calls);
    expect(flat).not.toContain(PASSPHRASE.k1);
    expect(flat).toContain(join(root, "keys", "k1"));
    const pgEnv = calls.find((c) => c[0]!.cmd === "pg_dump")![0]!;
    expect(pgEnv.args.join(" ")).not.toContain("me_backup_dev");
    expect(pgEnv.env?.PGPASSWORD).toBe("me_backup_dev");
  });

  it("công cụ lỗi giữa chừng → lỗi, không có bản chính thức, thư mục tạm được dọn", async () => {
    await media("anh", "public");
    failOn = "gpg";
    await expect(run()).rejects.toThrow("tool_failed:gpg");
    expect(sets()).toEqual([]);
    expect(tmpLeft()).toEqual([]);
  });

  it("tệp media thiếu hoặc sai nội dung → lỗi, không có bản chính thức", async () => {
    const hash = await media("anh", "public");
    writeFileSync(join(config.mediaRoot, "public", `${hash}.png`), "bi-sua");
    await expect(run()).rejects.toThrow("media_mismatch");
    rmSync(join(config.mediaRoot, "public", `${hash}.png`));
    await expect(run()).rejects.toThrow("media_missing");
    expect(sets()).toEqual([]);
  });

  it("mất lease trước khi công bố → không có bản mới, không dọn bản cũ", async () => {
    await run(new Date("2026-09-01T02:30:00Z"));
    await run(new Date("2026-09-02T02:30:00Z"));
    const before = sets();
    const stale = await lease();
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second'`);
    await acquireLease("me.backup.daily", "worker-khac");
    await expect(backup({ config, run: fakeRun, lease: stale, signal: new AbortController().signal, now: new Date("2026-10-31T02:30:00Z") })).rejects.toThrow("lease_lost");
    expect(sets()).toEqual(before);
    expect(tmpLeft()).toEqual([]);
  });

  it("giữ 30 ngày, không bao giờ xóa bản mới nhất; tệp media chỉ xóa khi không manifest nào trỏ tới", async () => {
    const old = await media("anh-cu", "public");
    await run(new Date("2026-09-20T02:30:00Z"));
    await sqlAsMigrator(`ALTER TABLE media_assets DISABLE TRIGGER USER`);
    await sqlAsMigrator(`DELETE FROM lesson_version_assets`);
    await sqlAsMigrator(`DELETE FROM media_assets WHERE sha256 = $1`, [old]);
    await sqlAsMigrator(`ALTER TABLE media_assets ENABLE TRIGGER USER`);
    const keep = await media("anh-moi", "public");
    await run(new Date("2026-10-15T02:30:00Z"));
    expect(blobs()).toEqual([`${old}.k1.gpg`, `${keep}.k1.gpg`].sort());
    const stats = await run(new Date("2026-10-31T02:30:00Z"));
    expect(stats.pruned).toBe(1);
    expect(sets()).toHaveLength(2);
    expect(blobs()).toEqual([`${keep}.k1.gpg`]);
  });

  it("thiếu tệp khóa hiện tại → lỗi trước khi chạy gì, bản cũ quá 30 ngày vẫn giữ", async () => {
    await run(new Date("2026-08-01T02:30:00Z"));
    calls = [];
    await expect(run(new Date("2026-10-31T02:30:00Z"), { ...config, keysDir: join(root, "khong-co") })).rejects.toThrow("backup_key_missing");
    expect(calls).toEqual([]);
    expect(sets()).toHaveLength(1);
  });

  it("đổi khóa: bản mới chỉ trỏ tệp khóa mới; bản cũ giữ khóa cũ; hết hạn thì tệp khóa cũ bị dọn", async () => {
    const hash = await media("anh", "public");
    await run(new Date("2026-09-20T02:30:00Z"));
    await run(new Date("2026-10-01T02:30:00Z"), { ...config, keyId: "k2" });
    const [first, second] = sets();
    expect(manifest(first!).media[0]!.kid).toBe("k1");
    expect(manifest(second!).media[0]!.kid).toBe("k2");
    expect(manifest(second!).kid).toBe("k2");
    expect(blobs()).toEqual([`${hash}.k1.gpg`, `${hash}.k2.gpg`]);
    await run(new Date("2026-10-31T02:30:00Z"), { ...config, keyId: "k2" });
    expect(blobs()).toEqual([`${hash}.k2.gpg`]);
  });

  it("thiếu tệp khóa của một bản còn giữ → báo trong kết quả", async () => {
    await media("anh", "public");
    await run(new Date("2026-10-20T02:30:00Z"));
    rmSync(join(root, "keys", "k1"));
    const stats = await run(new Date("2026-10-31T02:30:00Z"), { ...config, keyId: "k2" });
    expect(stats.missingKeys).toEqual(["k1"]);
    const ok = await run(new Date("2026-10-31T03:30:00Z"), { ...config, keyId: "k2" });
    expect(ok.missingKeys).toEqual(["k1"]);
  });

  it("có nơi lưu ngoài: đẩy media và bản dump, kiểm, rồi mới ghi COMPLETE", async () => {
    await media("anh", "public");
    const remote = join(root, "remote");
    const stats = await run(new Date(), { ...config, remote });
    expect(stats.offsite).toBe(true);
    const [name] = sets();
    expect(existsSync(join(remote, "db", name!, "db.dump.gpg"))).toBe(true);
    expect(readFileSync(join(remote, "db", name!, "COMPLETE"), "utf8")).toBe(sha(readFileSync(join(root, "backups/db", name!, "manifest.json"), "utf8")));
    expect(readdirSync(join(remote, "media-store"))).toHaveLength(1);
    const ops = calls.filter((c) => c[0]!.cmd === "rclone").map((c) => c[0]!.args[0]);
    expect(ops.indexOf("check")).toBeLessThan(ops.indexOf("copyto"));
  });

  it("rclone lỗi → job lỗi, không ghi COMPLETE, bản cục bộ vẫn còn", async () => {
    await media("anh", "public");
    const remote = join(root, "remote");
    failOn = "check";
    await expect(run(new Date(), { ...config, remote })).rejects.toThrow("tool_failed");
    const [name] = sets();
    expect(name).toBeDefined();
    expect(existsSync(join(remote, "db", name!, "COMPLETE"))).toBe(false);
  });
});

describe("job sao lưu", () => {
  it("lịch 02:30 giờ VN, quá giờ 2 giờ", async () => {
    const { JOBS } = await import("@/modules/jobs/definitions");
    const job = JOBS.find((j) => j.name === "me.backup.daily")!;
    expect(job.schedule).toEqual({ dailyAt: "02:30" });
    expect(job.timeoutMs).toBe(2 * 3_600_000);
  });

  it("chưa có nơi lưu ngoài → thành công kèm một cảnh báo mỗi ngày; chưa cấu hình ở production → skipped kèm cảnh báo", async () => {
    const { backupAlerts } = await import("@/modules/ops/backup");
    await backupAlerts({ offsite: false }, new Date("2026-10-31T19:30:00Z"));
    await backupAlerts({ offsite: false }, new Date("2026-10-31T20:30:00Z"));
    await backupAlerts({ notConfigured: true }, new Date("2026-10-31T20:30:00Z"));
    await backupAlerts({ missingKeys: ["k1"] }, new Date("2026-10-31T20:30:00Z"));
    const alerts = await prisma().outboxEvent.findMany({ where: { kind: "backup_alert" }, orderBy: { dedupKey: "asc" } });
    expect(alerts.map((a) => (a.payload as { reason: string }).reason)).toEqual(["missing_key", "no_offsite", "not_configured"]);
    expect(alerts.every((a) => a.channel === "telegram")).toBe(true);
  });
});

