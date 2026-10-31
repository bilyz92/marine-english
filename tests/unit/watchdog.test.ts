import { describe, expect, it } from "vitest";
import { tickStuck } from "@/worker/watchdog";

describe("watchdog", () => {
  it("lượt tick treo quá 5 phút → cần thoát; đang chạy bình thường hoặc không có lượt nào → không", () => {
    const now = 1_000_000_000;
    expect(tickStuck(now - 5 * 60_000 - 1, now)).toBe(true);
    expect(tickStuck(now - 4 * 60_000, now)).toBe(false);
    expect(tickStuck(null, now)).toBe(false);
  });
});
