import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { errCode, pgAs } from "../helpers/pg";

let db: Client;
beforeAll(async () => {
  db = await pgAs("migrator");
});
afterAll(async () => {
  await db.end();
});

async function user(name = "Minh"): Promise<string> {
  const { rows } = await db.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [name]);
  return rows[0].id;
}
async function admin(email: string, role = "owner", status = "active"): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at)
     VALUES ($1, $2, $3, now(), now() + interval '7 days') RETURNING id`,
    [email, role, status],
  );
  return rows[0].id;
}
async function device(userId: string): Promise<string> {
  const { rows } = await db.query(
    "INSERT INTO devices (user_id, device_key_hash, label) VALUES ($1, md5(random()::text), 'máy') RETURNING id",
    [userId],
  );
  return rows[0].id;
}
async function session(userId: string): Promise<string> {
  const d = await device(userId);
  const { rows } = await db.query(
    `INSERT INTO learner_sessions (user_id, device_id, token_hash, auth_at, absolute_expires_at)
     VALUES ($1, $2, md5(random()::text), now(), now() + interval '90 days') RETURNING id`,
    [userId, d],
  );
  return rows[0].id;
}

describe("users", () => {
  it("merged phải có merged_into_id", async () => {
    expect(await errCode(db, "INSERT INTO users (display_name, status) VALUES ('a', 'merged')")).toBe("23514");
  });
  it("active không được có merged_into_id", async () => {
    const u = await user();
    expect(await errCode(db, "INSERT INTO users (display_name, merged_into_id) VALUES ('b', $1)", [u])).toBe("23514");
  });
  it("chặn vòng gộp A→B, B→A", async () => {
    const a = await user("A");
    const b = await user("B");
    await db.query("UPDATE users SET status = 'merged', merged_into_id = $2 WHERE id = $1", [a, b]);
    expect(await errCode(db, "UPDATE users SET status = 'merged', merged_into_id = $2 WHERE id = $1", [b, a])).toBe("P0001");
  });
});

describe("user_identities", () => {
  it("không trùng (kind, value)", async () => {
    const u = await user();
    const v = await user();
    await db.query("INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1,'email','a@b.vn',now())", [u]);
    expect(
      await errCode(db, "INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1,'email','a@b.vn',now())", [v]),
    ).toBe("23505");
  });
  it.each([["0912345678"], ["+84212345678"]])("phone %s sai định dạng bị từ chối", async (phone) => {
    const u = await user();
    expect(
      await errCode(db, "INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1,'phone',$2,now())", [u, phone]),
    ).toBe("23514");
  });
  it("phone hợp lệ được nhận", async () => {
    const u = await user();
    expect(
      await errCode(db, "INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1,'phone','+84912345678',now())", [u]),
    ).toBeNull();
  });
});

describe("devices và phiên", () => {
  it("devices không trùng (user_id, device_key_hash)", async () => {
    const u = await user();
    await db.query("INSERT INTO devices (user_id, device_key_hash, label) VALUES ($1,'h1','a')", [u]);
    expect(await errCode(db, "INSERT INTO devices (user_id, device_key_hash, label) VALUES ($1,'h1','b')", [u])).toBe("23505");
  });
  it("prev_valid_until và next_token_enc phải cùng có hoặc cùng NULL", async () => {
    const s = await session(await user());
    expect(await errCode(db, "UPDATE learner_sessions SET prev_valid_until = now() WHERE id = $1", [s])).toBe("23514");
  });
  it("session_token_history không trùng hash và không UPDATE", async () => {
    const s = await session(await user());
    await db.query("INSERT INTO session_token_history (session_id, token_hash, detect_until) VALUES ($1,'t1',now()+interval '37 days')", [s]);
    expect(
      await errCode(db, "INSERT INTO session_token_history (session_id, token_hash, detect_until) VALUES ($1,'t1',now())", [s]),
    ).toBe("23505");
    expect(await errCode(db, "UPDATE session_token_history SET detect_until = now()")).toBe("P0001");
  });
});

describe("thời hạn cố định bằng CHECK", () => {
  it("login_tickets 10 phút", async () => {
    const u = await user();
    expect(
      await errCode(
        db,
        `INSERT INTO login_tickets (token_hash, user_id, device_key_hash, device_label, created_at, expires_at)
         VALUES ('x',$1,'d','m', now(), now() + interval '10 minutes 1 second')`,
        [u],
      ),
    ).toBe("23514");
  });
  it("oidc_states 10 phút", async () => {
    expect(
      await errCode(
        db,
        `INSERT INTO oidc_states (state_hash, realm, intent, nonce, code_verifier, created_at, expires_at)
         VALUES ('s','learner','login','n','v', now(), now() + interval '9 minutes 59 seconds')`,
      ),
    ).toBe("23514");
  });
  it("otp_challenges 5 phút", async () => {
    expect(
      await errCode(
        db,
        `INSERT INTO otp_challenges (purpose, kind, value_canonical, code_hmac, key_version, created_at, expires_at)
         VALUES ('login','email','a@b.vn','h','v1', now(), now() + interval '5 minutes 1 second')`,
      ),
    ).toBe("23514");
  });
  it("admin_email_links 15 phút", async () => {
    const a = await admin("a@b.vn");
    expect(
      await errCode(
        db,
        "INSERT INTO admin_email_links (token_hash, admin_user_id, created_at, expires_at) VALUES ('l',$1, now(), now() + interval '14 minutes 59 seconds')",
        [a],
      ),
    ).toBe("23514");
  });
  it("admin_users lời mời 7 ngày", async () => {
    expect(
      await errCode(
        db,
        "INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at) VALUES ('x@y.vn','owner','invited', now(), now() + interval '7 days 1 second')",
      ),
    ).toBe("23514");
  });
});

describe("otp_challenges", () => {
  const insert = (value: string, userId: string | null = null, purpose = "login", attempts = 0) =>
    errCode(
      db,
      `INSERT INTO otp_challenges (purpose, kind, value_canonical, user_id, code_hmac, key_version, attempts, created_at, expires_at)
       VALUES ($1,'email',$2,$3,'h','v1',$4, now(), now() + interval '5 minutes')`,
      [purpose, value, userId, attempts],
    );
  it("chỉ một thử thách hiệu lực cho (purpose, kind, value)", async () => {
    expect(await insert("a@b.vn")).toBeNull();
    expect(await insert("a@b.vn")).toBe("23505");
  });
  it("purpose link bắt buộc user_id", async () => {
    expect(await insert("c@d.vn", null, "link")).toBe("23514");
  });
  it("attempts tối đa 5", async () => {
    expect(await insert("e@f.vn", null, "login", 6)).toBe("23514");
  });
});

describe("oidc_states", () => {
  const insert = (intent: string, userId: string | null) =>
    errCode(
      db,
      `INSERT INTO oidc_states (state_hash, realm, intent, user_id, nonce, code_verifier, created_at, expires_at)
       VALUES (md5(random()::text),'learner',$1,$2,'n','v', now(), now() + interval '10 minutes')`,
      [intent, userId],
    );
  it("intent link bắt buộc user_id", async () => {
    expect(await insert("link", null)).toBe("23514");
  });
  it("intent lạ bị từ chối", async () => {
    expect(await insert("other", null)).toBe("23514");
  });
});

describe("quản trị và nhật ký", () => {
  it("role và status lạ bị từ chối", async () => {
    expect(
      await errCode(db, "INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at) VALUES ('r@s.vn','boss','active', now(), now()+interval '7 days')"),
    ).toBe("23514");
    expect(
      await errCode(db, "INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at) VALUES ('t@s.vn','owner','paused', now(), now()+interval '7 days')"),
    ).toBe("23514");
  });
  it("admin_users không DELETE được", async () => {
    const a = await admin("del@x.vn");
    expect(await errCode(db, "DELETE FROM admin_users WHERE id = $1", [a])).toBe("P0001");
  });
  it("admin_identities không trùng google_sub", async () => {
    const a = await admin("g1@x.vn");
    const b = await admin("g2@x.vn");
    await db.query("INSERT INTO admin_identities (admin_user_id, google_sub) VALUES ($1,'sub-1')", [a]);
    expect(await errCode(db, "INSERT INTO admin_identities (admin_user_id, google_sub) VALUES ($1,'sub-1')", [b])).toBe("23505");
  });
  it("admin_email_links không DELETE được", async () => {
    const a = await admin("l@x.vn");
    await db.query("INSERT INTO admin_email_links (token_hash, admin_user_id, created_at, expires_at) VALUES ('t',$1, now(), now()+interval '15 minutes')", [a]);
    expect(await errCode(db, "DELETE FROM admin_email_links")).toBe("P0001");
  });
  it("admin_audit_log không UPDATE/DELETE được", async () => {
    await db.query("INSERT INTO admin_audit_log (action, target_type, result) VALUES ('test','x','ok')");
    expect(await errCode(db, "UPDATE admin_audit_log SET reason = 'x'")).toBe("P0001");
    expect(await errCode(db, "DELETE FROM admin_audit_log")).toBe("P0001");
  });
});
