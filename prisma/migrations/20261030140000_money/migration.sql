-- Tiền: đơn có ảnh chụp bất biến, sổ giao dịch bất biến, phân bổ/kết luận loại trừ nhau, hoàn tiền có nguồn, quyền học có nguồn gốc.
-- Bất biến được giữ ở tầng DB (CHECK, trigger, constraint trigger hoãn); me_app không có quyền DELETE.

-- ===== Đơn =====
CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "code" TEXT NOT NULL CONSTRAINT "orders_code_key" UNIQUE CHECK ("code" ~ '^ME[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'paid', 'expired', 'refunded')),
  "amount_due_vnd" INTEGER NOT NULL CHECK ("amount_due_vnd" > 0),
  "currency" TEXT NOT NULL DEFAULT 'VND' CHECK ("currency" = 'VND'),
  "refund_policy_version" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "paid_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "refunded_at" TIMESTAMPTZ(6),
  CONSTRAINT "orders_ttl_check" CHECK ("expires_at" = "created_at" + interval '15 minutes'),
  CONSTRAINT "orders_paid_at_check" CHECK (("paid_at" IS NOT NULL) = ("status" IN ('paid', 'refunded'))),
  CONSTRAINT "orders_refunded_at_check" CHECK (("refunded_at" IS NOT NULL) = ("status" = 'refunded'))
);
CREATE INDEX "orders_user_id_idx" ON "orders" ("user_id");

CREATE FUNCTION "orders_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."user_id" <> OLD."user_id" OR NEW."created_at" <> OLD."created_at"
     OR NEW."expires_at" <> OLD."expires_at" OR NEW."amount_due_vnd" <> OLD."amount_due_vnd"
     OR NEW."currency" <> OLD."currency" OR NEW."refund_policy_version" <> OLD."refund_policy_version" THEN
    RAISE EXCEPTION 'order_immutable';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'pending' AND NEW."status" IN ('paid', 'expired'))
    OR (OLD."status" = 'expired' AND NEW."status" = 'paid')
    OR (OLD."status" = 'paid' AND NEW."status" = 'refunded')) THEN
    RAISE EXCEPTION 'order_transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_guard" BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION "orders_guard"();
CREATE TRIGGER "orders_no_delete" BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE RESTRICT,
  "course_version_id" UUID NOT NULL REFERENCES "course_versions"("id") ON DELETE RESTRICT,
  "list_price_vnd" INTEGER NOT NULL CHECK ("list_price_vnd" > 0),
  "final_price_vnd" INTEGER NOT NULL CHECK ("final_price_vnd" >= 0)
);
CREATE INDEX "order_items_order_id_idx" ON "order_items" ("order_id");
CREATE TRIGGER "order_items_immutable" BEFORE UPDATE OR DELETE ON "order_items" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- Tổng giá các dòng = số phải trả, kiểm khi commit transaction tạo đơn.
CREATE FUNCTION "orders_items_total_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT coalesce(sum("final_price_vnd"), 0) FROM "order_items" WHERE "order_id" = NEW."id") <> NEW."amount_due_vnd" THEN
    RAISE EXCEPTION 'order_items_total_mismatch';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "orders_items_total" AFTER INSERT ON "orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "orders_items_total_check"();

-- ===== Sổ giao dịch =====
CREATE TABLE "bank_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_code" TEXT NOT NULL CHECK ("bank_code" ~ '^[A-Z0-9]{2,20}$'),
  "account_no" TEXT NOT NULL CHECK ("account_no" ~ '^[0-9]{4,30}$'),
  "bank_ref" TEXT NOT NULL CHECK ("bank_ref" = upper(btrim("bank_ref")) AND "bank_ref" <> ''),
  "amount_vnd" INTEGER NOT NULL CHECK ("amount_vnd" > 0),
  "currency" TEXT NOT NULL DEFAULT 'VND' CHECK ("currency" = 'VND'),
  "direction" TEXT NOT NULL DEFAULT 'in' CHECK ("direction" = 'in'),
  "content" TEXT NOT NULL,
  "bank_time" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "source" TEXT NOT NULL CHECK ("source" IN ('sepay_webhook', 'sepay_api', 'manual')),
  "entered_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "evidence" TEXT,
  "raw" JSONB,
  CONSTRAINT "bank_transactions_identity_key" UNIQUE ("bank_code", "account_no", "bank_ref"),
  CONSTRAINT "bank_transactions_manual_check" CHECK (("source" = 'manual') = ("entered_by" IS NOT NULL AND "evidence" IS NOT NULL))
);
CREATE TRIGGER "bank_transactions_immutable" BEFORE UPDATE OR DELETE ON "bank_transactions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "bank_transaction_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_transaction_id" UUID REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "source" TEXT NOT NULL CHECK ("source" IN ('sepay_webhook', 'sepay_api', 'manual')),
  "provider_event_id" TEXT,
  "payload" JSONB,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "is_first" BOOLEAN NOT NULL DEFAULT false,
  "mismatch" BOOLEAN NOT NULL DEFAULT false,
  "ignored_reason" TEXT,
  "unresolved_reason" TEXT CHECK ("unresolved_reason" IN ('missing_ref', 'missing_time')),
  "resolves_observation_id" UUID UNIQUE REFERENCES "bank_transaction_observations"("id") ON DELETE RESTRICT,
  CONSTRAINT "observations_link_check" CHECK ("bank_transaction_id" IS NOT NULL OR "ignored_reason" IS NOT NULL OR "unresolved_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "observations_provider_event_key" ON "bank_transaction_observations" ("source", "provider_event_id")
  WHERE "provider_event_id" IS NOT NULL;
CREATE INDEX "observations_bank_transaction_id_idx" ON "bank_transaction_observations" ("bank_transaction_id");

CREATE FUNCTION "observations_resolves_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."resolves_observation_id" IS NOT NULL THEN
    IF NEW."source" <> 'manual' OR NEW."bank_transaction_id" IS NULL OR NEW."resolves_observation_id" = NEW."id" THEN
      RAISE EXCEPTION 'observation_resolve_invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "bank_transaction_observations" WHERE "id" = NEW."resolves_observation_id"
                   AND "bank_transaction_id" IS NULL AND "unresolved_reason" IS NOT NULL) THEN
      RAISE EXCEPTION 'observation_resolve_target_invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "observations_resolves" BEFORE INSERT ON "bank_transaction_observations"
  FOR EACH ROW EXECUTE FUNCTION "observations_resolves_check"();
CREATE TRIGGER "observations_immutable" BEFORE UPDATE OR DELETE ON "bank_transaction_observations"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "bank_transaction_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_transaction_id" UUID NOT NULL REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "method" TEXT NOT NULL CHECK ("method" IN ('provider', 'provider_match', 'owner')),
  "verified_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "evidence" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "verifications_owner_check" CHECK (("method" = 'owner') = ("verified_by" IS NOT NULL AND "evidence" IS NOT NULL))
);
CREATE INDEX "verifications_bank_transaction_id_idx" ON "bank_transaction_verifications" ("bank_transaction_id");

CREATE FUNCTION "verifications_not_self_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."method" = 'owner' AND NEW."verified_by" = (SELECT "entered_by" FROM "bank_transactions" WHERE "id" = NEW."bank_transaction_id") THEN
    RAISE EXCEPTION 'verify_own_entry';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "verifications_not_self" BEFORE INSERT ON "bank_transaction_verifications"
  FOR EACH ROW EXECUTE FUNCTION "verifications_not_self_check"();
CREATE TRIGGER "verifications_immutable" BEFORE UPDATE OR DELETE ON "bank_transaction_verifications"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "bank_transaction_classifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_transaction_id" UUID NOT NULL REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "classifier_version" TEXT NOT NULL,
  "result" TEXT NOT NULL CHECK ("result" IN ('auto_confirm', 'queue')),
  "reason" TEXT,
  "candidate_codes" TEXT[] NOT NULL,
  "candidate_order_id" UUID REFERENCES "orders"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "classifications_reason_check" CHECK (("result" = 'queue') = ("reason" IS NOT NULL))
);
CREATE INDEX "classifications_bank_transaction_id_idx" ON "bank_transaction_classifications" ("bank_transaction_id", "created_at");
CREATE TRIGGER "classifications_immutable" BEFORE UPDATE OR DELETE ON "bank_transaction_classifications"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- ===== Phân bổ và kết luận (loại trừ nhau) =====
CREATE TABLE "payment_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_transaction_id" UUID NOT NULL UNIQUE REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "amount_vnd" INTEGER NOT NULL CHECK ("amount_vnd" > 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('auto', 'manual')),
  "allocated_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "allocations_by_check" CHECK (("kind" = 'manual') = ("allocated_by" IS NOT NULL))
);
CREATE INDEX "allocations_order_id_idx" ON "payment_allocations" ("order_id");

CREATE FUNCTION "allocations_amount_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amount_vnd" <> (SELECT "amount_vnd" FROM "bank_transactions" WHERE "id" = NEW."bank_transaction_id") THEN
    RAISE EXCEPTION 'allocation_amount_mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "allocations_amount" BEFORE INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION "allocations_amount_check"();
CREATE TRIGGER "allocations_immutable" BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "bank_transaction_dispositions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "bank_transaction_id" UUID NOT NULL REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('duplicate', 'ignored')),
  "reason" TEXT NOT NULL,
  "decided_by" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "superseded_at" TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "dispositions_active_key" ON "bank_transaction_dispositions" ("bank_transaction_id") WHERE "superseded_at" IS NULL;

CREATE FUNCTION "dispositions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."superseded_at" IS NOT NULL OR NEW."superseded_at" IS NULL
     OR (NEW."id", NEW."bank_transaction_id", NEW."kind", NEW."reason", NEW."decided_by", NEW."created_at")
        IS DISTINCT FROM (OLD."id", OLD."bank_transaction_id", OLD."kind", OLD."reason", OLD."decided_by", OLD."created_at") THEN
    RAISE EXCEPTION 'disposition_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "dispositions_guard" BEFORE UPDATE OR DELETE ON "bank_transaction_dispositions"
  FOR EACH ROW EXECUTE FUNCTION "dispositions_guard"();

-- Một dòng sổ không được vừa có phân bổ vừa có kết luận hiệu lực (kiểm khi commit; người ghi đã khóa dòng sổ).
CREATE FUNCTION "settlement_exclusive_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payment_allocations" WHERE "bank_transaction_id" = NEW."bank_transaction_id")
     AND EXISTS (SELECT 1 FROM "bank_transaction_dispositions" WHERE "bank_transaction_id" = NEW."bank_transaction_id" AND "superseded_at" IS NULL) THEN
    RAISE EXCEPTION 'settlement_conflict';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "allocations_exclusive" AFTER INSERT ON "payment_allocations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "settlement_exclusive_check"();
CREATE CONSTRAINT TRIGGER "dispositions_exclusive" AFTER INSERT ON "bank_transaction_dispositions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "settlement_exclusive_check"();

-- ===== Hoàn tiền =====
CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('full', 'excess')),
  "amount_vnd" INTEGER NOT NULL CHECK ("amount_vnd" > 0),
  "status" TEXT NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested', 'approved', 'sent', 'confirmed', 'failed', 'cancelled')),
  "reason" TEXT NOT NULL,
  "out_bank_ref" TEXT UNIQUE,
  "evidence" TEXT,
  "requested_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "approved_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "sent_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "confirmed_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "approved_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "confirmed_at" TIMESTAMPTZ(6),
  "closed_at" TIMESTAMPTZ(6),
  CONSTRAINT "refunds_out_ref_check" CHECK ("status" NOT IN ('sent', 'confirmed') OR "out_bank_ref" IS NOT NULL)
);
CREATE UNIQUE INDEX "refunds_one_active_full_key" ON "refunds" ("order_id")
  WHERE "kind" = 'full' AND "status" NOT IN ('failed', 'cancelled');

CREATE FUNCTION "refunds_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."order_id" <> OLD."order_id" OR NEW."kind" <> OLD."kind" OR NEW."amount_vnd" <> OLD."amount_vnd" THEN
    RAISE EXCEPTION 'refund_immutable';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'requested' AND NEW."status" IN ('approved', 'cancelled'))
    OR (OLD."status" = 'approved' AND NEW."status" IN ('sent', 'cancelled'))
    OR (OLD."status" = 'sent' AND NEW."status" IN ('confirmed', 'failed'))) THEN
    RAISE EXCEPTION 'refund_transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "refunds_guard" BEFORE UPDATE ON "refunds" FOR EACH ROW EXECUTE FUNCTION "refunds_guard"();
CREATE TRIGGER "refunds_no_delete" BEFORE DELETE ON "refunds" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "refund_sources" (
  "refund_id" UUID NOT NULL REFERENCES "refunds"("id") ON DELETE RESTRICT,
  "bank_transaction_id" UUID NOT NULL REFERENCES "bank_transactions"("id") ON DELETE RESTRICT,
  "amount_vnd" INTEGER NOT NULL CHECK ("amount_vnd" > 0),
  PRIMARY KEY ("refund_id", "bank_transaction_id")
);
CREATE TRIGGER "refund_sources_immutable" BEFORE UPDATE OR DELETE ON "refund_sources" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- Kiểm tiền của một refund khi commit: nguồn thuộc đơn, tổng nguồn = số hoàn, không hoàn quá tiền từng dòng sổ,
-- full = số phải trả, tổng excess ≤ phần thừa thực tế. Refund failed/cancelled không còn giữ tiền.
CREATE FUNCTION "refund_money_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r "refunds"%ROWTYPE;
  v_refund_id UUID;
BEGIN
  -- Dùng chung cho refunds (id) và refund_sources (refund_id).
  v_refund_id := coalesce((to_jsonb(NEW) ->> 'refund_id')::uuid, (to_jsonb(NEW) ->> 'id')::uuid);
  SELECT * INTO r FROM "refunds" WHERE "id" = v_refund_id;
  IF r."status" IN ('failed', 'cancelled') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "refund_sources" s
    WHERE s."refund_id" = r."id" AND NOT EXISTS (
      SELECT 1 FROM "payment_allocations" pa WHERE pa."bank_transaction_id" = s."bank_transaction_id" AND pa."order_id" = r."order_id")
  ) THEN
    RAISE EXCEPTION 'refund_source_not_of_order';
  END IF;
  IF (SELECT coalesce(sum("amount_vnd"), 0) FROM "refund_sources" WHERE "refund_id" = r."id") <> r."amount_vnd" THEN
    RAISE EXCEPTION 'refund_sources_total_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "refund_sources" s JOIN "bank_transactions" bt ON bt."id" = s."bank_transaction_id"
    WHERE s."refund_id" = r."id" AND bt."amount_vnd" < (
      SELECT sum(s2."amount_vnd") FROM "refund_sources" s2 JOIN "refunds" r2 ON r2."id" = s2."refund_id"
      WHERE s2."bank_transaction_id" = bt."id" AND r2."status" NOT IN ('failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'refund_exceeds_transaction';
  END IF;
  IF r."kind" = 'full' AND r."amount_vnd" <> (SELECT "amount_due_vnd" FROM "orders" WHERE "id" = r."order_id") THEN
    RAISE EXCEPTION 'refund_full_amount_mismatch';
  END IF;
  IF r."kind" = 'excess' AND (
    SELECT coalesce(sum("amount_vnd"), 0) FROM "refunds"
    WHERE "order_id" = r."order_id" AND "kind" = 'excess' AND "status" NOT IN ('failed', 'cancelled')
  ) > (
    SELECT coalesce(sum(pa."amount_vnd"), 0) FROM "payment_allocations" pa WHERE pa."order_id" = r."order_id"
  ) - (SELECT "amount_due_vnd" FROM "orders" WHERE "id" = r."order_id") THEN
    RAISE EXCEPTION 'refund_excess_too_large';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "refunds_money" AFTER INSERT OR UPDATE ON "refunds"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "refund_money_check"();
CREATE CONSTRAINT TRIGGER "refund_sources_money" AFTER INSERT ON "refund_sources"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "refund_money_check"();

-- ===== Quyền học =====
CREATE TABLE "enrollments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE RESTRICT,
  "source" TEXT NOT NULL CHECK ("source" IN ('order', 'grant')),
  "order_id" UUID REFERENCES "orders"("id") ON DELETE RESTRICT,
  "grant_reason" TEXT,
  "granted_by" UUID REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_reason" TEXT,
  CONSTRAINT "enrollments_order_source_check"
    CHECK (("source" = 'order') = ("order_id" IS NOT NULL AND "grant_reason" IS NULL AND "granted_by" IS NULL)),
  CONSTRAINT "enrollments_grant_source_check"
    CHECK (("source" = 'grant') = ("order_id" IS NULL AND "grant_reason" IS NOT NULL AND "granted_by" IS NOT NULL)),
  CONSTRAINT "enrollments_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
  CONSTRAINT "enrollments_order_course_key" UNIQUE ("order_id", "course_id")
);
CREATE INDEX "enrollments_user_course_idx" ON "enrollments" ("user_id", "course_id");

CREATE FUNCTION "enrollments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."user_id", NEW."course_id", NEW."source", NEW."order_id", NEW."grant_reason", NEW."granted_by", NEW."created_at")
     IS DISTINCT FROM (OLD."id", OLD."user_id", OLD."course_id", OLD."source", OLD."order_id", OLD."grant_reason", OLD."granted_by", OLD."created_at")
     OR (OLD."revoked_at" IS NOT NULL AND (NEW."revoked_at", NEW."revoked_reason") IS DISTINCT FROM (OLD."revoked_at", OLD."revoked_reason")) THEN
    RAISE EXCEPTION 'enrollment_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "enrollments_guard" BEFORE UPDATE ON "enrollments" FOR EACH ROW EXECUTE FUNCTION "enrollments_guard"();
CREATE TRIGGER "enrollments_no_delete" BEFORE DELETE ON "enrollments" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- ===== Outbox (P4 gửi) =====
CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "dedup_key" TEXT NOT NULL UNIQUE,
  "kind" TEXT NOT NULL,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('email', 'telegram')),
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'dead')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "sent_at" TIMESTAMPTZ(6)
);
CREATE INDEX "outbox_events_due_idx" ON "outbox_events" ("status", "next_attempt_at");

-- ===== Quyền =====
GRANT SELECT, INSERT ON "orders", "order_items", "bank_transactions", "bank_transaction_observations",
  "bank_transaction_verifications", "bank_transaction_classifications", "payment_allocations",
  "bank_transaction_dispositions", "refunds", "refund_sources", "enrollments", "outbox_events" TO me_app;
GRANT UPDATE ON "orders", "refunds", "enrollments", "bank_transaction_dispositions", "outbox_events" TO me_app;
