-- Tài khoản quản trị: me_app chỉ có SELECT trên admin_users; mọi thay đổi đi qua các hàm SECURITY DEFINER dưới đây
-- (chủ sở hữu me_migrator). Trigger giữ luôn còn ít nhất một owner đang hoạt động, kể cả với lệnh UPDATE thô của me_migrator.

-- Không bao giờ để mất owner active cuối cùng.
CREATE FUNCTION "admin_owner_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'owner' AND OLD."status" = 'active' AND (NEW."role" <> 'owner' OR NEW."status" <> 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtext('admin-owner-guard'));
    IF NOT EXISTS (
      SELECT 1 FROM "admin_users" WHERE "id" <> OLD."id" AND "role" = 'owner' AND "status" = 'active'
    ) THEN
      RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "admin_users_owner_guard" BEFORE UPDATE ON "admin_users"
  FOR EACH ROW EXECUTE FUNCTION "admin_owner_guard"();

-- Người thực hiện phải là owner đang hoạt động.
CREATE FUNCTION "admin_require_owner"(p_actor uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "admin_users" WHERE "id" = p_actor AND "role" = 'owner' AND "status" = 'active') THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
END $$;

-- Đổi role/status (NULL = giữ nguyên). Luôn thu hồi phiên của người bị đổi; hủy link khi không còn active/invited.
CREATE FUNCTION "admin_change"(p_actor uuid, p_admin uuid, p_role text, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('admin-owner-guard'));
  PERFORM "admin_require_owner"(p_actor);
  SELECT "status" INTO v_status FROM "admin_users" WHERE "id" = p_admin FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE "admin_users" SET "role" = coalesce(p_role, "role"), "status" = coalesce(p_status, "status") WHERE "id" = p_admin;
  UPDATE "admin_sessions" SET "revoked_at" = now() WHERE "admin_user_id" = p_admin AND "revoked_at" IS NULL;
  IF coalesce(p_status, v_status) NOT IN ('active', 'invited') THEN
    UPDATE "admin_email_links" SET "invalidated_at" = now()
    WHERE "admin_user_id" = p_admin AND "used_at" IS NULL AND "invalidated_at" IS NULL;
  END IF;
END $$;

-- Mời theo email (đã chuẩn hóa). Mời lại người đã hết hạn/bị thu hồi thì cấp hạn mới, hủy link cũ, thu hồi phiên.
CREATE FUNCTION "admin_invite"(p_actor uuid, p_email text, p_role text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cur "admin_users"%ROWTYPE;
BEGIN
  PERFORM "admin_require_owner"(p_actor);
  PERFORM pg_advisory_xact_lock(hashtext('admin-invite:' || p_email));
  SELECT * INTO cur FROM "admin_users" WHERE "email_lower" = p_email FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO "admin_users" ("email_lower", "role", "status", "invited_by", "invited_at", "invite_expires_at")
    VALUES (p_email, p_role, 'invited', p_actor, now(), now() + interval '7 days');
    RETURN 'invited';
  END IF;
  IF cur."status" = 'active' THEN
    RETURN 'already_active';
  END IF;
  IF cur."status" IN ('expired', 'revoked') OR now() >= cur."invite_expires_at" THEN
    UPDATE "admin_users"
    SET "status" = 'invited', "role" = p_role, "invited_by" = p_actor, "invited_at" = now(),
        "invite_expires_at" = now() + interval '7 days'
    WHERE "id" = cur."id";
    UPDATE "admin_email_links" SET "invalidated_at" = now()
    WHERE "admin_user_id" = cur."id" AND "used_at" IS NULL AND "invalidated_at" IS NULL;
    UPDATE "admin_sessions" SET "revoked_at" = now() WHERE "admin_user_id" = cur."id" AND "revoked_at" IS NULL;
  ELSE
    UPDATE "admin_users" SET "role" = p_role WHERE "id" = cur."id";
  END IF;
  RETURN 'invited';
END $$;

-- Kích hoạt lời mời còn hạn (gọi sau khi đã chứng minh email bằng link hoặc Google). Đã active thì không làm gì.
CREATE FUNCTION "admin_activate"(p_admin uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE "admin_users" SET "status" = 'active', "activated_at" = now()
  WHERE "id" = p_admin AND "status" = 'invited' AND now() < "invite_expires_at";
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM "admin_users" WHERE "id" = p_admin AND "status" = 'active') THEN
    RAISE EXCEPTION 'not_invitable' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- search_path cố định về schema của migration (public ở production, schema riêng ở test).
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "admin_owner_guard"() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION "admin_require_owner"(uuid) SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION "admin_change"(uuid, uuid, text, text) SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION "admin_invite"(uuid, text, text) SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION "admin_activate"(uuid) SET search_path = %I, pg_temp', current_schema());
END $$;

REVOKE ALL ON FUNCTION "admin_require_owner"(uuid), "admin_invite"(uuid, text, text),
  "admin_change"(uuid, uuid, text, text), "admin_activate"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_invite"(uuid, text, text), "admin_change"(uuid, uuid, text, text), "admin_activate"(uuid)
  TO me_app;
