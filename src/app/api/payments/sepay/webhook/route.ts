import { env } from "@/lib/env";
import { json } from "@/lib/http";
import { ingest } from "@/modules/ledger/ingest";
import { toBankReport, verifySepaySignature } from "@/modules/ledger/sepay";

// Webhook SePay — TD §4.2. Hạn chót 8 giây; mỗi lần thử: lock_timeout 2 s, statement_timeout 3 s; chỉ thử lại khi còn ≥ 3,5 s.
const MAX_BODY_BYTES = 65_536;
const DEADLINE_MS = 8_000;
const MIN_LEFT_FOR_RETRY_MS = 3_500;

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const { SEPAY_WEBHOOK_SECRETS: secrets, SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO } = env();
  if (secrets.length === 0 || !SEPAY_BANK_CODE || !SEPAY_ACCOUNT_NO) {
    return json({ error: "Chưa cấu hình SePay" }, { status: 503 });
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Chỉ nhận application/json" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Body quá lớn" }, { status: 413 });
  // Đọc byte gốc trước khi parse: chữ ký tính trên đúng chuỗi nhận được.
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return json({ error: "Body quá lớn" }, { status: 413 });
  const rawBody = new TextDecoder().decode(bytes);

  const check = verifySepaySignature(req.headers, rawBody, startedAt, secrets);
  if (check !== "ok") {
    console.warn("sepay_webhook_rejected", { reason: check });
    return json({ error: "Không xác thực được" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("sepay_webhook_bad_body", { reason: "json" });
    return json({ error: "Body không hợp lệ" }, { status: 400 });
  }
  const report = toBankReport(payload);
  if (!report) {
    console.warn("sepay_webhook_bad_body", { reason: "shape" });
    return json({ error: "Body không hợp lệ" }, { status: 400 });
  }
  try {
    await ingest(report, {
      lockTimeoutMs: 2_000,
      statementTimeoutMs: 3_000,
      deadlineAt: startedAt + DEADLINE_MS - MIN_LEFT_FOR_RETRY_MS,
    });
  } catch (error) {
    // Lỗi tạm thời: để SePay gửi lại. Không log body.
    console.error("sepay_webhook_failed", { code: (error as { code?: string }).code ?? "unknown" });
    return json({ error: "Tạm thời không xử lý được" }, { status: 503 });
  }
  return json({ success: true });
}
