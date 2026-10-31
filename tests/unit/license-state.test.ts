import { describe, expect, it } from "vitest";
import { licenseState } from "@/lib/offline/license-state";

const exp = 1_000_000;
const grace = 7 * 86_400;
const at = (deviceNow: number, maxSeen = 0) => licenseState({ exp, grace, deviceNow, maxSeen });

describe("hiệu lực giấy phép trên máy", () => {
  it("biên: exp − 1 ok; exp grace; exp + grace − 1 grace; exp + grace locked", () => {
    expect(at(exp - 1).state).toBe("ok");
    expect(at(exp).state).toBe("grace");
    expect(at(exp + grace - 1).state).toBe("grace");
    expect(at(exp + grace).state).toBe("locked");
  });

  it("đồng hồ bị chỉnh lùi: dùng mốc lớn nhất đã thấy, không sống lại", () => {
    expect(at(exp - 86_400 * 10, exp + grace)).toEqual({ state: "locked", maxSeen: exp + grace });
  });

  it("mốc lớn nhất được cập nhật khi giờ máy tăng", () => {
    expect(at(exp - 100, exp - 500)).toEqual({ state: "ok", maxSeen: exp - 100 });
  });
});
