import { describe, expect, it } from "vitest";
import { clampText, OG_TEXT_STYLE, ogCard, titleSize } from "@/app/(site)/og-card";

describe("ảnh chia sẻ", () => {
  it("chuỗi dài bị cắt ở ranh giới từ, có dấu …, không quá giới hạn; chuỗi ngắn giữ nguyên", () => {
    expect(clampText("Máy ba", 100)).toBe("Máy ba");
    const long = "Tên khóa rất dài ".repeat(15).trim();
    const cut = clampText(long, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
  it("chữ liền không dấu cách được phép xuống dòng giữa từ (không tràn ảnh)", async () => {
    const png = Buffer.from(await ogCard({ eyebrow: "KHÓA HỌC", title: "x".repeat(200), subtitle: "y".repeat(200), footer: "z".repeat(200) }).arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(OG_TEXT_STYLE.wordBreak).toBe("break-word");
  });
  it("tiêu đề dài dùng chữ nhỏ hơn", () => {
    expect(titleSize(30)).toBeGreaterThan(titleSize(60));
    expect(titleSize(60)).toBeGreaterThan(titleSize(100));
  });
  it("dựng được ảnh PNG 1200×630 với tên khóa 200 ký tự có dấu tiếng Việt", async () => {
    const res = ogCard({ eyebrow: "KHÓA HỌC", title: "Thợ cả — Tàu hàng rời và tổng hợp ".repeat(6).slice(0, 200), subtitle: "x".repeat(200), footer: "1 bài · 1.000đ" });
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
