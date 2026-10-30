-- SELECT … FOR UPDATE cần quyền UPDATE trên ít nhất một cột. Dòng sổ phải khóa được (thứ tự khóa: dòng sổ → đơn → refund),
-- nên cấp UPDATE trên đúng cột id; trigger bank_transactions_immutable vẫn chặn mọi UPDATE thật.
GRANT UPDATE ("id") ON "bank_transactions" TO me_app;
