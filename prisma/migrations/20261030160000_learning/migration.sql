-- Học tập: tệp media (bất biến, theo sha256), sự kiện học (chỉ thêm), tiến độ (chỉ tăng), lần làm kiểm tra, sự kiện bị từ chối.

CREATE TABLE "media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "mime" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 104857600),
  "visibility" TEXT NOT NULL CHECK ("visibility" IN ('public', 'protected')),
  "storage_key" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER "media_assets_immutable" BEFORE UPDATE OR DELETE ON "media_assets" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "lesson_version_assets" (
  "lesson_version_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('audio', 'image', 'attachment')),
  PRIMARY KEY ("lesson_version_id", "media_asset_id")
);
ALTER TABLE "lesson_version_assets" ADD CONSTRAINT "lesson_version_assets_lesson_version_id_fkey"
  FOREIGN KEY ("lesson_version_id") REFERENCES "lesson_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "lesson_version_assets" ADD CONSTRAINT "lesson_version_assets_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE TRIGGER "lesson_version_assets_immutable" BEFORE UPDATE OR DELETE ON "lesson_version_assets" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "learning_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "event_id" UUID NOT NULL UNIQUE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "seq" BIGINT NOT NULL CHECK ("seq" >= 1),
  "lesson_version_id" UUID REFERENCES "lesson_versions"("id") ON DELETE RESTRICT,
  "course_id" UUID REFERENCES "courses"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL CHECK ("type" IN ('lesson_opened', 'activity_completed', 'lesson_completed', 'quiz_attempt')),
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "client_time" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "entitlement_ok" BOOLEAN NOT NULL,
  CONSTRAINT "learning_events_device_seq_key" UNIQUE ("device_id", "seq")
);
CREATE INDEX "learning_events_user_id_idx" ON "learning_events" ("user_id");
CREATE TRIGGER "learning_events_immutable" BEFORE UPDATE OR DELETE ON "learning_events" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "learning_progress" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "lesson_id" UUID NOT NULL REFERENCES "lessons"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL CHECK ("status" IN ('in_progress', 'completed')),
  "completed_activities" TEXT[] NOT NULL DEFAULT '{}',
  "best_score_pct" INTEGER CHECK ("best_score_pct" BETWEEN 0 AND 100),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "lesson_id")
);

-- Tiến độ chỉ tăng: không lùi trạng thái, không giảm điểm, không bớt hoạt động đã xong.
CREATE FUNCTION "learning_progress_monotonic"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."user_id" <> OLD."user_id" OR NEW."lesson_id" <> OLD."lesson_id"
     OR (OLD."status" = 'completed' AND NEW."status" <> 'completed')
     OR (OLD."best_score_pct" IS NOT NULL AND (NEW."best_score_pct" IS NULL OR NEW."best_score_pct" < OLD."best_score_pct"))
     OR NOT (NEW."completed_activities" @> OLD."completed_activities") THEN
    RAISE EXCEPTION 'progress_regression';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "learning_progress_monotonic" BEFORE UPDATE ON "learning_progress" FOR EACH ROW EXECUTE FUNCTION "learning_progress_monotonic"();
CREATE TRIGGER "learning_progress_no_delete" BEFORE DELETE ON "learning_progress" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "quiz_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "event_id" UUID NOT NULL UNIQUE REFERENCES "learning_events"("event_id") ON DELETE RESTRICT,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "lesson_id" UUID NOT NULL REFERENCES "lessons"("id") ON DELETE RESTRICT,
  "score_pct" INTEGER NOT NULL CHECK ("score_pct" BETWEEN 0 AND 100),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER "quiz_attempts_immutable" BEFORE UPDATE OR DELETE ON "quiz_attempts" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "sync_rejections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "event_id" UUID,
  "reason" TEXT NOT NULL,
  "raw" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER "sync_rejections_immutable" BEFORE UPDATE OR DELETE ON "sync_rejections" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

GRANT SELECT, INSERT ON "media_assets", "lesson_version_assets", "learning_events", "learning_progress", "quiz_attempts", "sync_rejections" TO me_app;
GRANT UPDATE ON "learning_progress" TO me_app;
