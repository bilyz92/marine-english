-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" TEXT NOT NULL,
    "rank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value_canonical" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_key_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auth_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "prev_valid_until" TIMESTAMPTZ(6),
    "next_token_enc" TEXT,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "learner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_token_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "rotated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detect_until" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_token_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "realm" TEXT NOT NULL DEFAULT 'learner',
    "purpose" TEXT NOT NULL DEFAULT 'replace_device',
    "device_key_hash" TEXT NOT NULL,
    "device_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "login_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value_canonical" TEXT NOT NULL,
    "user_id" UUID,
    "code_hmac" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "delivery_failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_send_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "value_canonical" TEXT NOT NULL,
    "ip" INET NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "otp_send_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zns_daily_budget" (
    "day" DATE NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "zns_daily_budget_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "oidc_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state_hash" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "user_id" UUID,
    "nonce" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "device_key_hash" TEXT,
    "device_label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "oidc_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_lower" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invited_by" UUID,
    "invited_at" TIMESTAMPTZ(6) NOT NULL,
    "invite_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "google_sub" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auth_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_email_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_email_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "ip" INET,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_kind_value_canonical_key" ON "user_identities"("kind", "value_canonical");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_device_key_hash_key" ON "devices"("user_id", "device_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "learner_sessions_token_hash_key" ON "learner_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_history_token_hash_key" ON "session_token_history"("token_hash");

-- CreateIndex
CREATE INDEX "session_token_history_session_id_rotated_at_idx" ON "session_token_history"("session_id", "rotated_at");

-- CreateIndex
CREATE UNIQUE INDEX "login_tickets_token_hash_key" ON "login_tickets"("token_hash");

-- CreateIndex
CREATE INDEX "otp_send_log_kind_value_canonical_sent_at_idx" ON "otp_send_log"("kind", "value_canonical", "sent_at");

-- CreateIndex
CREATE INDEX "otp_send_log_ip_sent_at_idx" ON "otp_send_log"("ip", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_states_state_hash_key" ON "oidc_states"("state_hash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_lower_key" ON "admin_users"("email_lower");

-- CreateIndex
CREATE UNIQUE INDEX "admin_identities_admin_user_id_key" ON "admin_identities"("admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_identities_google_sub_key" ON "admin_identities"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_email_links_token_hash_key" ON "admin_email_links"("token_hash");

-- CreateIndex
CREATE INDEX "admin_audit_log_at_idx" ON "admin_audit_log"("at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_sessions" ADD CONSTRAINT "learner_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_sessions" ADD CONSTRAINT "learner_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_token_history" ADD CONSTRAINT "session_token_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learner_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_identities" ADD CONSTRAINT "admin_identities_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_email_links" ADD CONSTRAINT "admin_email_links_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Phần viết tay: ràng buộc Prisma không diễn tả được, trigger, phân quyền.
-- =====================================================================

-- users
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled', 'merged'));
ALTER TABLE "users" ADD CONSTRAINT "users_merged_check" CHECK (("status" = 'merged') = ("merged_into_id" IS NOT NULL));

CREATE FUNCTION "forbid_merge_cycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."merged_into_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT NEW."merged_into_id"
      UNION
      SELECT u."merged_into_id" FROM "users" u JOIN chain c ON u."id" = c.id WHERE u."merged_into_id" IS NOT NULL
    )
    SELECT 1 FROM chain WHERE id = NEW."id"
  ) THEN
    RAISE EXCEPTION 'merge_cycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "users_no_merge_cycle" BEFORE INSERT OR UPDATE OF "merged_into_id" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "forbid_merge_cycle"();

-- user_identities
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_kind_check" CHECK ("kind" IN ('phone', 'email', 'google'));
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_phone_check"
  CHECK ("kind" <> 'phone' OR "value_canonical" ~ '^\+84[35789][0-9]{8}$');

-- learner_sessions: phong bì và hạn cửa sổ đi cùng nhau
ALTER TABLE "learner_sessions" ADD CONSTRAINT "learner_sessions_envelope_check"
  CHECK (("prev_valid_until" IS NULL) = ("next_token_enc" IS NULL));

-- thời hạn cố định
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_ttl_check" CHECK ("expires_at" = "created_at" + interval '10 minutes');
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_ttl_check" CHECK ("expires_at" = "created_at" + interval '10 minutes');
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_ttl_check" CHECK ("expires_at" = "created_at" + interval '5 minutes');
ALTER TABLE "admin_email_links" ADD CONSTRAINT "admin_email_links_ttl_check" CHECK ("expires_at" = "created_at" + interval '15 minutes');
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invite_ttl_check" CHECK ("invite_expires_at" = "invited_at" + interval '7 days');

-- otp_challenges
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_purpose_check" CHECK ("purpose" IN ('signup', 'login', 'link'));
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_kind_check" CHECK ("kind" IN ('email', 'phone'));
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5);
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_link_user_check" CHECK (("purpose" = 'link') = ("user_id" IS NOT NULL));
CREATE UNIQUE INDEX "otp_challenges_one_active_key" ON "otp_challenges" ("purpose", "kind", "value_canonical")
  WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;

-- otp_send_log, zns_daily_budget
ALTER TABLE "zns_daily_budget" ADD CONSTRAINT "zns_daily_budget_used_check" CHECK ("used" >= 0);

-- oidc_states
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_realm_check" CHECK ("realm" IN ('learner', 'admin'));
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_intent_check" CHECK ("intent" IN ('login', 'link', 'admin_login'));
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_link_user_check" CHECK (("intent" = 'link') = ("user_id" IS NOT NULL));

-- login_tickets
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_realm_check" CHECK ("realm" = 'learner');
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_purpose_check" CHECK ("purpose" = 'replace_device');

-- admin_users, admin_email_links, admin_audit_log
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_check" CHECK ("role" IN ('owner', 'support'));
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_status_check" CHECK ("status" IN ('invited', 'active', 'expired', 'revoked'));
ALTER TABLE "admin_email_links" ADD CONSTRAINT "admin_email_links_purpose_check" CHECK ("purpose" = 'login');
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_result_check" CHECK ("result" IN ('ok', 'denied'));

-- Chặn sửa/xóa các bảng bất biến (áp cả với chủ sở hữu bảng).
CREATE FUNCTION "forbid_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER "admin_users_no_delete" BEFORE DELETE ON "admin_users" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "admin_email_links_no_delete" BEFORE DELETE ON "admin_email_links" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "admin_audit_log_immutable" BEFORE UPDATE OR DELETE ON "admin_audit_log" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "session_token_history_no_update" BEFORE UPDATE ON "session_token_history" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- Phân quyền cho vai trò ứng dụng me_app (vai trò phải tồn tại trước khi migrate; xem docker/postgres-init.sql và P5).
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO me_app', current_schema()); END $$;
GRANT SELECT, INSERT, UPDATE ON
  "users", "user_identities", "devices", "learner_sessions", "session_token_history", "login_tickets",
  "otp_challenges", "otp_send_log", "zns_daily_budget", "oidc_states", "admin_identities", "admin_sessions",
  "admin_email_links"
TO me_app;
GRANT SELECT ON "admin_users" TO me_app;
GRANT SELECT, INSERT ON "admin_audit_log" TO me_app;
GRANT DELETE ON "login_tickets", "oidc_states", "session_token_history", "user_identities" TO me_app;
