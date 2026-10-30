import { afterEach, expect, it } from "vitest";
import { setTestNow } from "@/lib/clock";
import { isRecentAuth } from "@/modules/sessions/sessions";

afterEach(() => setTestNow(null));

it("isRecentAuth: now − authAt < 10 phút", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  setTestNow(now);
  expect(isRecentAuth(new Date(now.getTime() - 10 * 60_000 + 1))).toBe(true);
  expect(isRecentAuth(new Date(now.getTime() - 10 * 60_000))).toBe(false);
});
