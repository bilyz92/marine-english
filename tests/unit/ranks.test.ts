import { describe, expect, it } from "vitest";
import { RANKS } from "@/app/(site)/dang-nhap/ranks";

describe("RANKS", () => {
  it("theo đúng danh sách và thứ tự chủ chốt 17/11/2026", () => {
    expect(RANKS).toEqual([
      "MÁY TRƯỞNG - C/E", "MÁY HAI - 2/E", "MÁY BA - 3/E", "MÁY TƯ - 4/E", "SĨ QUAN ĐIỆN, THỢ ĐIỆN - ETO,EE",
      "THỰC TẬP SINH MÁY - ENGINE CADET", "THỢ CẢ - FITTER", "THỢ MÁY - MOTORMAN", "PHỤ MÁY - WIPER",
      "BỘ PHẬN BOONG - DECK DEPARTMENT", "ĐANG HỌC - MARITIME STUDENT", "KHÁC - OTHER",
    ]);
  });
  it("vừa giới hạn 100 ký tự của API đăng ký", () => {
    for (const r of RANKS) expect(r.length).toBeLessThanOrEqual(100);
  });
});
