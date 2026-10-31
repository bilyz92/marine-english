import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("web chạy được khi không có URL DB quyền cao (migrator, shadow)", async () => {
  vi.stubEnv("MIGRATOR_DATABASE_URL", undefined as unknown as string);
  vi.stubEnv("SHADOW_DATABASE_URL", undefined as unknown as string);
  delete process.env.MIGRATOR_DATABASE_URL;
  delete process.env.SHADOW_DATABASE_URL;
  vi.resetModules();
  const { env } = await import("@/lib/env");
  const e = env() as Record<string, unknown>;
  expect(e.MIGRATOR_DATABASE_URL).toBeUndefined();
  expect(e.DATABASE_URL).toBeTruthy();
});

it("biến tùy chọn để trống (Compose truyền chuỗi rỗng) coi như chưa cấu hình", async () => {
  for (const name of ["SEPAY_BANK_CODE", "SEPAY_ACCOUNT_NO", "SEPAY_WEBHOOK_SECRETS", "CHECKOUT_BANK_NAME", "CHECKOUT_ACCOUNT_NAME", "CHECKOUT_QR_IMAGE", "CHECKOUT_TERMS_VERSION", "TELEGRAM_BOT_TOKEN", "TELEGRAM_BUSINESS_CHAT_ID", "TELEGRAM_ERROR_CHAT_ID", "ME_OTHER_DATABASE_URL"]) {
    vi.stubEnv(name, "");
  }
  vi.resetModules();
  const { env } = await import("@/lib/env");
  const e = env();
  expect(e.SEPAY_BANK_CODE).toBeUndefined();
  expect(e.SEPAY_ACCOUNT_NO).toBeUndefined();
  expect(e.SEPAY_WEBHOOK_SECRETS).toEqual([]);
  expect(e.CHECKOUT_QR_IMAGE).toBeUndefined();
  expect(e.TELEGRAM_BOT_TOKEN).toBeUndefined();
});
