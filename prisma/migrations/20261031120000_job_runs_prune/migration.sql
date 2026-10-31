-- Outbox chạy mỗi 10 giây nên nhật ký job tăng nhanh. me_app không được xóa nhật ký tùy ý, chỉ gọi hàm này:
-- xóa dòng quá 30 ngày, giữ dòng mà yêu cầu “chạy ngay” còn trỏ tới.
CREATE FUNCTION "prune_job_runs"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM "job_runs" r
  WHERE r."started_at" < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM "job_requests" q WHERE q."run_id" = r."id");
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "prune_job_runs"() SET search_path = %I, pg_temp', current_schema());
END $$;
REVOKE ALL ON FUNCTION "prune_job_runs"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "prune_job_runs"() TO me_app;
