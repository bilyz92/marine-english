// Lệnh quản trị chạy trên máy chủ bằng MIGRATOR_DATABASE_URL (không qua web):
//   pnpm cli admin:bootstrap <email>
//   pnpm cli admin:recover <email> --reason "<lý do>" --confirm <email>
//   pnpm cli admin:login-link <email>   (in link đăng nhập quản trị 15 phút, dùng một lần; cần SESSION_KEY_ADMIN, APP_ORIGIN; thay email khi chưa có G7)
//   pnpm cli admin:set-password <email>   (in mật khẩu tạm ngẫu nhiên MỘT lần cho quản trị đang hoạt động; đăng nhập rồi đổi ở mục Mật khẩu)
//   pnpm cli content:import <tệp.json>
//   pnpm cli license:public-keys   (in NEXT_PUBLIC_LICENSE_PUBLIC_KEYS từ LICENSE_SIGNING_KEYS, dùng khi build app)
//   pnpm cli media:add <mã bài> <tệp> [--role audio|image|attachment] [--public]   (MEDIA_ROOT, mặc định ./media)
// Tệp tự chứa (chỉ dùng pg) để chạy thẳng bằng Node, không cần bước build.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { hashPassword } from "../modules/auth-learner/password-hash.ts";
import { importContent } from "./content-import.ts";
import { addMedia } from "./media-import.ts";
import { publicKeyringFromSeeds } from "./license-keys.ts";

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

/**
 * Link đăng nhập quản trị in ra màn hình, thay cho email khi chưa có nhà cung cấp email (G7). Chỉ ai vào được máy chủ mới chạy được.
 * Giống link gửi qua email: 15 phút, dùng một lần, link cũ bị hủy; token chỉ lưu dạng HMAC (cùng cách với tokenHash("admin")).
 */
export async function issueLoginLink(
  client: Client,
  email: string,
  opts: { adminKey: string; origin: string },
): Promise<string | "not_found"> {
  const canonical = canonicalEmail(email);
  if (!canonical) return "not_found";
  const token = randomBytes(32).toString("base64url");
  const hash = createHmac("sha256", Buffer.from(opts.adminKey, "base64")).update(token).digest("hex");
  const issued = await inTransaction<boolean>(client, async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM admin_users WHERE email_lower = $1 AND (status = 'active' OR (status = 'invited' AND now() < invite_expires_at))`,
      [canonical],
    );
    const admin = rows[0];
    if (!admin) return false;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`admin-link:${admin.id}`]);
    await client.query(
      `UPDATE admin_email_links SET invalidated_at = now() WHERE admin_user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
      [admin.id],
    );
    await client.query(
      `INSERT INTO admin_email_links (token_hash, admin_user_id, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
      [hash, admin.id],
    );
    await auditSystem(client, "cli_login_link", admin.id, null);
    return true;
  });
  return issued ? `${opts.origin}/admin/dang-nhap#link=${token}` : "not_found";
}

/**
 * Mật khẩu tạm cho quản trị đang hoạt động (D3): khi chủ chưa đặt được mật khẩu bằng link, hoặc quên mật khẩu.
 * Sinh ngẫu nhiên (18 ký tự), chỉ lưu bản băm scrypt, thu hồi mọi phiên quản trị của người đó, ghi nhật ký. Mật khẩu chỉ in ra một lần.
 */
export async function setAdminPassword(client: Client, email: string): Promise<{ password: string } | "not_found"> {
  const canonical = canonicalEmail(email);
  if (!canonical) return "not_found";
  const raw = randomBytes(12).toString("base64url").replace(/[-_]/g, "x");
  const password = `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12)}`;
  const hash = await hashPassword(password);
  const done = await inTransaction<boolean>(client, async () => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM admin_users WHERE email_lower = $1 AND status = 'active' FOR UPDATE`, [canonical]);
    const admin = rows[0];
    if (!admin) return false;
    await client.query(
      `INSERT INTO admin_passwords (admin_user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (admin_user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [admin.id, hash],
    );
    await client.query(`UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = $1 AND revoked_at IS NULL`, [admin.id]);
    await auditSystem(client, "cli_set_password", admin.id, null);
    return true;
  });
  return done ? { password } : "not_found";
}

function flag(args: string[], name: string): string {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : "";
}

async function main(argv: string[]): Promise<number> {
  const [command, email = ""] = argv;
  if (command === "license:public-keys") {
    console.log(`NEXT_PUBLIC_LICENSE_PUBLIC_KEYS=${publicKeyringFromSeeds(process.env.LICENSE_SIGNING_KEYS ?? "")}`);
    return 0;
  }
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
    if (command === "admin:login-link") {
      const adminKey = process.env.SESSION_KEY_ADMIN;
      const origin = process.env.APP_ORIGIN;
      if (!adminKey || !origin) {
        console.error("Thiếu SESSION_KEY_ADMIN hoặc APP_ORIGIN");
        return 2;
      }
      const result = await issueLoginLink(client, email, { adminKey, origin });
      console.log(result === "not_found" ? "Không có quản trị viên đang hoạt động với email này." : `Link đăng nhập (15 phút, dùng một lần):\n${result}`);
      return result === "not_found" ? 1 : 0;
    }
    if (command === "admin:set-password") {
      const result = await setAdminPassword(client, email);
      console.log(result === "not_found"
        ? "Không có quản trị viên đang hoạt động với email này."
        : `Mật khẩu tạm (chỉ hiện lần này, các phiên cũ đã bị đăng xuất):\n${result.password}\nĐăng nhập rồi đổi ngay ở mục Mật khẩu trong trang quản trị.`);
      return result === "not_found" ? 1 : 0;
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
    console.error("Lệnh: media:add <mã bài> <tệp> | content:import <tệp.json> | admin:bootstrap <email> | admin:login-link <email> | admin:recover <email> --reason \"<lý do>\" --confirm <email>");
    return 2;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
