import { createHmac } from "node:crypto";
import { safeEqualHex } from "@/lib/crypto";
import type { BankReport } from "./ingest";

// Hợp đồng SePay [G4]: chuỗi ký, tên header và tên trường payload nằm hết ở tệp này để sửa một chỗ khi có tài liệu chính thức.

export const MAX_SKEW_SECONDS = 300;

export function signaturePayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export type SignatureCheck = "ok" | "missing" | "bad_signature" | "stale";

/** HMAC-SHA256 (hex) của `${timestamp}.${rawBody}`, thử mọi bí mật; timestamp (giây Unix) lệch tối đa 5 phút. */
export function verifySepaySignature(headers: Headers, rawBody: string, nowMs: number, secrets: string[]): SignatureCheck {
  const timestamp = headers.get("x-sepay-timestamp");
  // SePay gửi "sha256=<hex>" (developer.sepay.vn/vi/sepay-webhooks/xac-thuc); vẫn nhận hex trần.
  const signature = headers.get("x-sepay-signature")?.trim().toLowerCase().replace(/^sha256=/, "");
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return "missing";
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return "stale";
  const base = signaturePayload(timestamp, rawBody);
  const ok = secrets.some((secret) => safeEqualHex(createHmac("sha256", secret).update(base).digest("hex"), signature));
  return ok ? "ok" : "bad_signature";
}

/** 'YYYY-MM-DD HH:mm:ss' giờ Việt Nam → Date UTC; sai định dạng → null (ghi nhận “thiếu thời điểm”). */
function parseVnTime(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value.replace(" ", "T")}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Ánh xạ payload SePay sang báo cáo chung của sổ; sai kiểu các trường bắt buộc → null. API đối soát giả định cùng dạng với webhook [G4]. */
export function toBankReport(payload: unknown, source: "sepay_webhook" | "sepay_api" = "sepay_webhook"): BankReport | null {
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  const { id, gateway, accountNumber, transferType, transferAmount, content, referenceCode, transactionDate } = p;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    typeof gateway !== "string" ||
    typeof accountNumber !== "string" ||
    (transferType !== "in" && transferType !== "out") ||
    typeof transferAmount !== "number" ||
    typeof content !== "string"
  ) {
    return null;
  }
  return {
    source,
    providerEventId: String(id),
    bankCode: gateway.trim().toUpperCase(),
    accountNo: accountNumber.trim(),
    bankRef: typeof referenceCode === "string" ? referenceCode : null,
    amountVnd: transferAmount,
    direction: transferType,
    currency: "VND",
    content,
    bankTime: parseVnTime(transactionDate),
    raw: payload,
  };
}
