import type { SepayApi } from "./reconcile";

// SePay API v2, danh sách giao dịch (developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach, đọc 11/11/2026):
// GET {base}/transactions, "Authorization: Bearer <API token>", tối đa 100 dòng mỗi trang, 3 lần gọi mỗi giây.
// Mỗi giao dịch được đổi về đúng dạng payload webhook để đi qua cùng toBankReport và cùng khóa chống trùng
// (ngân hàng, số tài khoản, số tham chiếu): tiền về qua webhook rồi qua đối soát chỉ được ghi một lần.

export const SEPAY_API_BASE = "https://userapi.sepay.vn/v2";
const PER_PAGE = 100;
const TIMEOUT_MS = 20_000;
const PAGE_GAP_MS = 400;
const MAX_ATTEMPTS = 3;

type Deps = { token: string; baseUrl?: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> };

/** Giờ Việt Nam dạng 'YYYY-MM-DD HH:mm:ss' (cách SePay ghi giờ giao dịch). */
const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

/** Giao dịch API v2 → dạng webhook; trường thiếu hoặc sai kiểu giữ nguyên để toBankReport từ chối. */
function asWebhookShape(item: Record<string, unknown>): Record<string, unknown> {
  const time = typeof item.transaction_date === "string" ? new Date(item.transaction_date) : null;
  return {
    id: item.id,
    gateway: item.bank_brand_name,
    accountNumber: item.account_number,
    transferType: item.transfer_type,
    transferAmount: item.transfer_type === "out" ? item.amount_out : item.amount_in,
    content: item.transaction_content,
    referenceCode: item.reference_number,
    code: item.code,
    transactionDate: time && !Number.isNaN(time.getTime()) ? vnTime(time) : null,
    api: item,
  };
}

export function createSepayApi({ token, baseUrl = SEPAY_API_BASE, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: Deps): SepayApi {
  return {
    async listTransactions({ from, cursor }) {
      const page = Number(cursor ?? "1");
      const url = new URL(`${baseUrl}/transactions`);
      url.search = new URLSearchParams({
        transfer_type: "in", transaction_date_sort: "asc", per_page: String(PER_PAGE), page: String(page),
        transaction_date_from: vnTime(from), timestamp_format: "iso8601",
      }).toString();
      if (page > 1) await sleep(PAGE_GAP_MS);
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status === 429 && attempt < MAX_ATTEMPTS) {
          const wait = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1000 : 1000 * attempt);
          continue;
        }
        if (!res.ok) throw new Error(`sepay_api_${res.status}`);
        const body = (await res.json().catch(() => null)) as { status?: string; data?: unknown; meta?: { pagination?: { has_more?: boolean } } } | null;
        const hasMore = body?.meta?.pagination?.has_more;
        if (body?.status !== "success" || !Array.isArray(body.data) || typeof hasMore !== "boolean") throw new Error("sepay_api_malformed");
        return {
          items: body.data.map((item) => asWebhookShape(item as Record<string, unknown>)),
          nextCursor: hasMore ? String(page + 1) : undefined,
        };
      }
    },
  };
}
