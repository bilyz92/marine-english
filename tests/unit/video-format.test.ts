import { describe, expect, it } from "vitest";
import { parseYouTubeId, sniffVideo } from "@/modules/content/video-format";

// Nhận diện tệp video theo byte đầu và tách mã YouTube (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 1).

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(12)]);
const ebml = (docType: string) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]), Buffer.from(docType), Buffer.alloc(20)]);

describe("sniffVideo", () => {
  it("mp4 và m4v → video/mp4", () => {
    expect(sniffVideo(ftyp("isom"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("mp42"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("M4V "))).toBe("video/mp4");
    expect(sniffVideo(ftyp("avc1"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("iso5"))).toBe("video/mp4");
  });
  it("tệp ISO BMFF không phải video phát được (ảnh AVIF/HEIF, 3GP, nhãn lạ) → null", () => {
    for (const brand of ["avif", "avis", "heic", "heix", "mif1", "msf1", "3gp4", "crx ", "abcd"]) expect(sniffVideo(ftyp(brand)), brand).toBeNull();
  });
  it("webm → video/webm; mkv không nhận", () => {
    expect(sniffVideo(ebml("webm"))).toBe("video/webm");
    expect(sniffVideo(ebml("matroska"))).toBeNull();
  });
  it("mov của iPhone, tệp chỉ có tiếng, mp3, rác → null", () => {
    expect(sniffVideo(ftyp("qt  "))).toBeNull();
    expect(sniffVideo(ftyp("M4A "))).toBeNull();
    expect(sniffVideo(ftyp("M4B "))).toBeNull();
    expect(sniffVideo(ftyp("M4P "))).toBeNull();
    expect(sniffVideo(Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000am-thanh"))).toBeNull();
    expect(sniffVideo(Buffer.from("xin chào"))).toBeNull();
    expect(sniffVideo(Buffer.alloc(0))).toBeNull();
  });
});

describe("parseYouTubeId", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  youtu.be/${ID}  `,
  ])("%s → mã 11 ký tự", (url) => expect(parseYouTubeId(url)).toBe(ID));
  it.each([
    "https://vimeo.com/123456",
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${ID}xx`,
    "https://www.youtube.com/",
    "không phải link",
    "",
  ])("%s → null", (url) => expect(parseYouTubeId(url)).toBeNull());
});
