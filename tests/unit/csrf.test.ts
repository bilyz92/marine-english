import { describe, expect, it } from "vitest";
import { checkCsrf, csrfFor } from "@/modules/sessions/csrf";

describe("CSRF gắn phiên", () => {
  it("đúng → true", () => {
    expect(checkCsrf("learner", "s1", csrfFor("learner", "s1"))).toBe(true);
    expect(checkCsrf("admin", "s1", csrfFor("admin", "s1"))).toBe(true);
  });
  it("thiếu, sai, của phiên khác, của khu vực khác → false", () => {
    expect(checkCsrf("learner", "s1", null)).toBe(false);
    expect(checkCsrf("learner", "s1", "")).toBe(false);
    expect(checkCsrf("learner", "s1", "deadbeef")).toBe(false);
    expect(checkCsrf("learner", "s1", csrfFor("learner", "s2"))).toBe(false);
    expect(checkCsrf("learner", "s1", csrfFor("admin", "s1"))).toBe(false);
  });
});
