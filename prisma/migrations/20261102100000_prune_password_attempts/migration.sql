-- D2 / G12a: lượt thử mật khẩu (IP, số, đúng/sai) giữ 30 ngày. me_app không được xóa bảng này, chỉ gọi hàm này.
CREATE FUNCTION "prune_password_attempts"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM "password_attempts" WHERE "at" < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION "prune_password_attempts"() SET search_path = %I, pg_temp', current_schema());
END $$;
REVOKE ALL ON FUNCTION "prune_password_attempts"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "prune_password_attempts"() TO me_app;
