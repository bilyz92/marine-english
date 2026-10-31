import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABOUT } from "@/content/about";
import { formatVnd } from "@/lib/format";

const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

describe("WEB-10 nguyên văn", () => {
  it("mọi đoạn của bài có đúng từng chữ trong bản thiết kế và đủ các đoạn chính", () => {
    const source = words(readFileSync("docs/design/giao-dien-v1/About.dc.html", "utf8"));
    for (const block of ABOUT) expect(source).toContain(block.text);
    const texts = ABOUT.map((b) => b.text);
    expect(texts[0]).toBe("Câu chuyện người sáng lập");
    expect(texts.at(-1)).toBe("Đây là hành trình cá nhân, không phải cam kết thời gian thăng tiến, kết quả tuyển dụng hoặc thu nhập cho học viên.");
    expect(texts.length).toBeGreaterThanOrEqual(17);
  });
});

describe("formatVnd", () => {
  it("đúng dạng 249.000đ", () => {
    expect(formatVnd(249000)).toBe("249.000đ");
    expect(formatVnd(1096000)).toBe("1.096.000đ");
  });
});
