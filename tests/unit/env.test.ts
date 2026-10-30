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
