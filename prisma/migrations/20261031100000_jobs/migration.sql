-- Worker: lease có token + generation (fencing), nhật ký từng lần chạy, yêu cầu “chạy ngay” từ trang quản trị; claim cho outbox.

CREATE TABLE "job_leases" (
  "job_name" TEXT NOT NULL PRIMARY KEY,
  "token" UUID NOT NULL,
  "generation" BIGINT NOT NULL CHECK ("generation" >= 1),
  "holder" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "job_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "job_name" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL CHECK ("status" IN ('running', 'success', 'failed', 'skipped', 'timeout')),
  "error" TEXT,
  "stats" JSONB,
  "generation" BIGINT
);
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" ("job_name", "started_at" DESC);

CREATE TABLE "job_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "job_name" TEXT NOT NULL,
  "requested_by" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "picked_at" TIMESTAMPTZ(6),
  "run_id" UUID REFERENCES "job_runs"("id") ON DELETE RESTRICT
);
CREATE INDEX "job_requests_pending_idx" ON "job_requests" ("requested_at") WHERE "picked_at" IS NULL;

ALTER TABLE "outbox_events" ADD COLUMN "claim_token" UUID;
ALTER TABLE "outbox_events" ADD COLUMN "claimed_until" TIMESTAMPTZ(6);

-- Lời mời quản trị quá hạn → expired, hủy link chưa dùng. me_app chỉ đổi admin_users qua hàm SECURITY DEFINER.
CREATE FUNCTION "admin_expire_invites"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n integer;
BEGIN
  WITH expired AS (
    UPDATE "admin_users" SET "status" = 'expired'
    WHERE "status" = 'invited' AND "invite_expires_at" <= now()
    RETURNING "id"
  ), links AS (
    UPDATE "admin_email_links" SET "invalidated_at" = now()
    WHERE "admin_user_id" IN (SELECT "id" FROM expired) AND "used_at" IS NULL AND "invalidated_at" IS NULL
  )
  SELECT count(*) INTO n FROM expired;
  RETURN n;
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "admin_expire_invites"() SET search_path = %I, pg_temp', current_schema());
END $$;
REVOKE ALL ON FUNCTION "admin_expire_invites"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_expire_invites"() TO me_app;

GRANT SELECT, INSERT, UPDATE ON "job_leases", "job_runs", "job_requests" TO me_app;
