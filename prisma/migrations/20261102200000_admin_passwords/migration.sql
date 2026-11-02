-- D3 (02/11/2026): quản trị đăng nhập bằng email + mật khẩu. docs/superpowers/plans/2026-11-02-admin-password.md
CREATE TABLE "admin_passwords" (
  "admin_user_id" UUID NOT NULL PRIMARY KEY REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "password_hash" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE "admin_login_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "email_lower" TEXT NOT NULL,
  "ip" INET NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "admin_login_attempts_email_at_idx" ON "admin_login_attempts" ("email_lower", "at");
CREATE INDEX "admin_login_attempts_ip_at_idx" ON "admin_login_attempts" ("ip", "at");

GRANT SELECT, INSERT, UPDATE ON "admin_passwords" TO me_app;
GRANT SELECT, INSERT ON "admin_login_attempts" TO me_app;
GRANT UPDATE ("ok") ON "admin_login_attempts" TO me_app;

-- Lượt thử giữ 30 ngày (G12a); me_app không xóa được bảng, chỉ gọi hàm này (job me.auth.prune-password-attempts).
CREATE FUNCTION "prune_admin_login_attempts"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM "admin_login_attempts" WHERE "at" < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "prune_admin_login_attempts"() SET search_path = %I, pg_temp', current_schema());
END $$;
REVOKE ALL ON FUNCTION "prune_admin_login_attempts"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "prune_admin_login_attempts"() TO me_app;

-- Rời trạng thái đang hoạt động (thu hồi, hết hạn, mời lại) thì mật khẩu mất hiệu lực: kích hoạt lại phải đặt mật khẩu mới.
CREATE FUNCTION "admin_passwords_drop_on_inactive"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW."status" <> 'active' THEN
    DELETE FROM "admin_passwords" WHERE "admin_user_id" = NEW."id";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "admin_users_drop_password" AFTER UPDATE OF "status" ON "admin_users"
  FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status") EXECUTE FUNCTION "admin_passwords_drop_on_inactive"();

-- Khóa dòng quản trị (cùng khóa mà admin_change giữ khi đổi trạng thái) và cho biết còn đang hoạt động không.
-- me_app chỉ có SELECT trên admin_users nên không tự FOR UPDATE được.
CREATE FUNCTION "admin_lock_if_active"(p_admin uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM 1 FROM "admin_users" WHERE "id" = p_admin AND "status" = 'active' FOR UPDATE;
  RETURN FOUND;
END $$;

DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "admin_passwords_drop_on_inactive"() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION "admin_lock_if_active"(uuid) SET search_path = %I, pg_temp', current_schema());
END $$;
REVOKE ALL ON FUNCTION "admin_passwords_drop_on_inactive"(), "admin_lock_if_active"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_lock_if_active"(uuid) TO me_app;
