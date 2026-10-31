import { describe, expect, it } from "vitest";
import { errCode, pgAs } from "../helpers/pg";
import { sqlAsMigrator } from "../helpers/otp";
import { insertAdmin } from "../helpers/admin";

async function app<T>(run: (c: import("pg").Client) => Promise<T>) {
  const c = await pgAs("app");
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

describe("bảng job", () => {
  it("CHECK trạng thái và generation; outbox có cột claim", async () => {
    await app(async (c) => {
      expect(await errCode(c, `INSERT INTO job_leases (job_name, token, generation, holder, expires_at) VALUES ('me.x', gen_random_uuid(), 0, 'w', now())`)).toBe("23514");
      expect(await errCode(c, `INSERT INTO job_leases (job_name, token, generation, holder, expires_at) VALUES ('me.x', gen_random_uuid(), 1, 'w', now())`)).toBeNull();
      expect(await errCode(c, `INSERT INTO job_runs (job_name, status) VALUES ('me.x', 'la')`)).toBe("23514");
      expect(await errCode(c, `INSERT INTO job_runs (job_name, status) VALUES ('me.x', 'running')`)).toBeNull();
      expect(await errCode(c, `UPDATE outbox_events SET claim_token = gen_random_uuid(), claimed_until = now()`)).toBeNull();
      expect(await errCode(c, `DELETE FROM job_runs`)).toBe("42501");
    });
  });

  it("admin_expire_invites: lời mời quá hạn → expired, hủy link; còn hạn và active không đổi; me_app vẫn không UPDATE thẳng admin_users", async () => {
    const owner = await insertAdmin("chu@x.vn");
    const late = await insertAdmin("tre@x.vn", "support", "invited");
    await insertAdmin("con-han@x.vn", "support", "invited");
    await sqlAsMigrator(`UPDATE admin_users SET invited_at = invited_at - interval '8 days', invite_expires_at = invite_expires_at - interval '8 days' WHERE id = $1`, [late]);
    await sqlAsMigrator(`INSERT INTO admin_email_links (token_hash, admin_user_id, expires_at) VALUES ('h-tre', $1, now() + interval '15 minutes')`, [late]);
    await app(async (c) => {
      const { rows } = await c.query(`SELECT admin_expire_invites() AS n`);
      expect(rows[0].n).toBe(1);
      expect(await errCode(c, `UPDATE admin_users SET status = 'active'`)).toBe("42501");
    });
    const { rows } = await sqlAsMigrator(`SELECT email_lower, status FROM admin_users ORDER BY email_lower`);
    expect(rows.map((r) => [r.email_lower, r.status])).toEqual([["chu@x.vn", "active"], ["con-han@x.vn", "invited"], ["tre@x.vn", "expired"]]);
    const { rows: links } = await sqlAsMigrator(`SELECT invalidated_at FROM admin_email_links`);
    expect(links[0].invalidated_at).not.toBeNull();
    void owner;
  });
});
