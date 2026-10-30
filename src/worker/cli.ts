// Lệnh quản trị chạy trên máy chủ bằng MIGRATOR_DATABASE_URL (không qua web):
//   pnpm cli admin:bootstrap <email>
//   pnpm cli admin:recover <email> --reason "<lý do>" --confirm <email>
//   pnpm cli content:import <tệp.json>
//   pnpm cli media:add <mã bài> <tệp> [--role audio|image|attachment] [--public]   (MEDIA_ROOT, mặc định ./media)
// Tệp tự chứa (chỉ dùng pg) để chạy thẳng bằng Node, không cần bước build.
import { readFileSync } from "node:fs";
import pg from "pg";
import { importContent } from "./content-import.ts";
import { addMedia } from "./media-import.ts";

type Client = pg.Client;

// Giống canonicalizeEmail trong src/modules/identity/email.ts.
function canonicalEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

async function inTransaction<T>(client: Client, run: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await run();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function auditSystem(client: Client, action: string, targetId: string, reason: string | null) {
  await client.query(
    `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, result, reason)
     VALUES (NULL, $1, 'admin_user', $2, 'ok', $3)`,
    [action, targetId, reason],
  );
}

/** Tạo owner đầu tiên; đã có owner (bất kỳ trạng thái) thì không làm gì. */
export async function bootstrapOwner(client: Client, email: string): Promise<"created" | "owner_exists" | "invalid_email"> {
  const canonical = canonicalEmail(email);
  if (!canonical) return "invalid_email";
  return inTransaction<"created" | "owner_exists">(client, async () => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('admin-owner-guard'))`);
    const { rows } = await client.query(`SELECT 1 FROM admin_users WHERE role = 'owner' LIMIT 1`);
    if (rows.length > 0) return "owner_exists";
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at)
       VALUES ($1, 'owner', 'active', now(), now() + interval '7 days', now())
       ON CONFLICT (email_lower) DO UPDATE SET role = 'owner', status = 'active', activated_at = now()
       RETURNING id`,
      [canonical],
    );
    await auditSystem(client, "bootstrap", inserted.rows[0]!.id, null);
    return "created";
  });
}

/** Khôi phục khẩn cấp quyền chủ: owner active, gỡ Google, hủy link, thu hồi phiên, ghi nhật ký kèm lý do. */
export async function recoverOwner(
  client: Client,
  input: { email: string; reason: string; confirm: string },
): Promise<"recovered" | "rejected"> {
  const email = canonicalEmail(input.email);
  if (!email || canonicalEmail(input.confirm) !== email || input.reason.trim().length < 10) return "rejected";
  return inTransaction<"recovered">(client, async () => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('admin-owner-guard'))`);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at)
       VALUES ($1, 'owner', 'active', now(), now() + interval '7 days', now())
       ON CONFLICT (email_lower) DO UPDATE SET role = 'owner', status = 'active',
         activated_at = coalesce(admin_users.activated_at, now())
       RETURNING id`,
      [email],
    );
    const id = rows[0]!.id;
    await client.query(`DELETE FROM admin_identities WHERE admin_user_id = $1`, [id]);
    await client.query(
      `UPDATE admin_email_links SET invalidated_at = now() WHERE admin_user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
      [id],
    );
    await client.query(`UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = $1 AND revoked_at IS NULL`, [id]);
    await auditSystem(client, "emergency_recover", id, input.reason.trim());
    return "recovered";
  });
}

function flag(args: string[], name: string): string {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : "";
}

async function main(argv: string[]): Promise<number> {
  const [command, email = ""] = argv;
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) {
    console.error("Thiếu MIGRATOR_DATABASE_URL");
    return 2;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (command === "admin:bootstrap") {
      const result = await bootstrapOwner(client, email);
      console.log({ created: "Đã tạo tài khoản chủ.", owner_exists: "Đã có tài khoản chủ, không đổi gì.", invalid_email: "Email không hợp lệ." }[result]);
      return result === "created" ? 0 : 1;
    }
    if (command === "admin:recover") {
      const result = await recoverOwner(client, { email, reason: flag(argv, "--reason"), confirm: flag(argv, "--confirm") });
      console.log(result === "recovered" ? "Đã khôi phục quyền chủ." : "Từ chối: cần --confirm trùng email và --reason ít nhất 10 ký tự.");
      return result === "recovered" ? 0 : 1;
    }
    if (command === "content:import") {
      const result = await importContent(client, JSON.parse(readFileSync(email, "utf8")));
      console.log(`Đã nhập ${result.courses} khóa: ${result.newCourseVersions} phiên bản khóa mới, ${result.newLessonVersions} phiên bản bài mới.`);
      return 0;
    }
    if (command === "media:add") {
      const role = (flag(argv, "--role") || "audio") as "audio" | "image" | "attachment";
      const result = await addMedia(client, {
        externalLessonId: email,
        filePath: argv[2] ?? "",
        role,
        visibility: argv.includes("--public") ? "public" : "protected",
        root: process.env.MEDIA_ROOT || "./media",
      });
      console.log(`Đã gắn tệp vào ${result.attached} phiên bản bài.`);
      return 0;
    }
    console.error("Lệnh: media:add <mã bài> <tệp> | content:import <tệp.json> | admin:bootstrap <email> | admin:recover <email> --reason \"<lý do>\" --confirm <email>");
    return 2;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
