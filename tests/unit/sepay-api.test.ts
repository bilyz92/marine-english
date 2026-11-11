import { describe, expect, it } from "vitest";
import { createSepayApi } from "@/modules/ledger/sepay-api";
import { toBankReport } from "@/modules/ledger/sepay";

// Đối soát qua SePay API v2 (developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach, đọc 11/11/2026).

const apiItem = (patch: Record<string, unknown> = {}) => ({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", transaction_date: "2026-11-11T09:30:00+07:00", account_number: "0374699803",
  va: null, amount_in: 199000, amount_out: 0, accumulated: 1500000, transaction_content: "ME7K3QX9AB chuyen tien",
  reference_number: "FT26069ABC", code: "ME7K3QX9AB", bank_brand_name: "BIDV", bank_account_id: "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  va_id: null, webhook_success: 1, transfer_type: "in", ...patch,
});
const page = (data: unknown[], hasMore = false) => ({ status: "success", data, meta: { pagination: { total: data.length, per_page: 100, current_page: 1, last_page: 1, has_more: hasMore } } });

function fakeFetch(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: new URL(url), init: init ?? {} });
    const r = responses.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const sleeps: number[] = [];
const make = (f: ReturnType<typeof fakeFetch>) =>
  createSepayApi({ token: "tok-123", baseUrl: "https://userapi.sepay.vn/v2", fetch: f.fetch, sleep: async (ms) => { sleeps.push(ms); } });

describe("SePay API v2: danh sách giao dịch", () => {
  it("gọi đúng địa chỉ, khóa Bearer, chỉ tiền vào, cũ trước mới sau, 100 dòng mỗi trang, mốc giờ Việt Nam", async () => {
    const f = fakeFetch([{ status: 200, body: page([]) }]);
    await make(f).listTransactions({ from: new Date("2026-11-11T01:00:00Z") });
    const { url, init } = f.calls[0]!;
    expect(`${url.origin}${url.pathname}`).toBe("https://userapi.sepay.vn/v2/transactions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-123");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      transfer_type: "in", transaction_date_sort: "asc", per_page: "100", page: "1",
      transaction_date_from: "2026-11-11 08:00:00", timestamp_format: "iso8601",
    });
  });

  it("đổi giao dịch API về dạng webhook: cùng số tham chiếu, ngân hàng, giờ ngân hàng như webhook", async () => {
    const f = fakeFetch([{ status: 200, body: page([apiItem()]) }]);
    const { items, nextCursor } = await make(f).listTransactions({ from: new Date() });
    expect(nextCursor).toBeUndefined();
    const report = toBankReport(items[0], "sepay_api")!;
    expect(report).toMatchObject({
      source: "sepay_api", providerEventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", bankCode: "BIDV", accountNo: "0374699803",
      bankRef: "FT26069ABC", amountVnd: 199000, direction: "in", content: "ME7K3QX9AB chuyen tien",
    });
    expect(report.bankTime!.toISOString()).toBe("2026-11-11T02:30:00.000Z");
  });

  it("còn trang sau → con trỏ là số trang kế; trang sau gọi page=2", async () => {
    const f = fakeFetch([{ status: 200, body: page([apiItem()], true) }, { status: 200, body: page([]) }]);
    const api = make(f);
    const first = await api.listTransactions({ from: new Date() });
    expect(first.nextCursor).toBe("2");
    await api.listTransactions({ from: new Date(), cursor: first.nextCursor });
    expect(f.calls[1]!.url.searchParams.get("page")).toBe("2");
  });

  it("chuyển ra: số tiền lấy amount_out", async () => {
    const f = fakeFetch([{ status: 200, body: page([apiItem({ transfer_type: "out", amount_in: 0, amount_out: 50000 })]) }]);
    const report = toBankReport((await make(f).listTransactions({ from: new Date() })).items[0], "sepay_api")!;
    expect(report).toMatchObject({ direction: "out", amountVnd: 50000 });
  });

  it("429 → chờ Retry-After rồi thử lại; 3 lần 429 liền → lỗi", async () => {
    sleeps.length = 0;
    const ok = fakeFetch([{ status: 429, headers: { "retry-after": "2" } }, { status: 200, body: page([]) }]);
    await make(ok).listTransactions({ from: new Date() });
    expect(ok.calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
    const busy = fakeFetch([{ status: 429 }, { status: 429 }, { status: 429 }]);
    await expect(make(busy).listTransactions({ from: new Date() })).rejects.toThrow("sepay_api_429");
  });

  it("khóa sai (401) hoặc trả về không đúng dạng → lỗi, không trả danh sách rỗng", async () => {
    await expect(make(fakeFetch([{ status: 401, body: { status: "error" } }])).listTransactions({ from: new Date() })).rejects.toThrow("sepay_api_401");
    await expect(make(fakeFetch([{ status: 200, body: { status: "error" } }])).listTransactions({ from: new Date() })).rejects.toThrow("sepay_api_malformed");
    // Thiếu has_more thì không biết còn trang hay không: báo lỗi chứ không coi là trang cuối (bỏ sót tiền).
    await expect(make(fakeFetch([{ status: 200, body: { status: "success", data: [apiItem()] } }])).listTransactions({ from: new Date() })).rejects.toThrow("sepay_api_malformed");
  });
});
