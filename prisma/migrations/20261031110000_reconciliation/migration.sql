-- Con trỏ đối soát theo nhà cung cấp + tài khoản: chỉ cập nhật sau khi đã xử lý hết các trang.
CREATE TABLE "reconciliation_cursors" (
  "provider" TEXT NOT NULL,
  "bank_code" TEXT NOT NULL,
  "account_no" TEXT NOT NULL,
  "last_complete_bank_time" TIMESTAMPTZ(6) NOT NULL,
  "last_cursor_token" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("provider", "bank_code", "account_no")
);
GRANT SELECT, INSERT, UPDATE ON "reconciliation_cursors" TO me_app;
