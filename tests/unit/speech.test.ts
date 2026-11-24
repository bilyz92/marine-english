import { describe, expect, it } from "vitest";
import { ACCENT_KEY, pickAccentVoice, pickVietnameseVoice, pickVoice, RATE_KEY, speakableText, VOICE_KEY } from "@/lib/client/speech";

const voice = (name: string, lang: string, localService: boolean) => ({ name, lang, localService, voiceURI: name, default: false }) as SpeechSynthesisVoice;

describe("đọc bằng giọng trên máy", () => {
  it("bỏ chỗ trống [..] chưa điền, báo có chỗ trống", () => {
    expect(speakableText("My name is [full_name]. I am [age] years old.")).toEqual({ text: "My name is. I am years old.", hadBlanks: true });
    expect(speakableText("Check the  pump.")).toEqual({ text: "Check the pump.", hadBlanks: false });
    expect(speakableText("[a] [b]")).toEqual({ text: "", hadBlanks: true });
  });

  it("chỉ chọn giọng tiếng Anh cài trên máy; ưu tiên giọng đã chọn, rồi giọng Mỹ", () => {
    const remote = voice("Google US English", "en-US", false);
    const uk = voice("Daniel", "en-GB", true);
    const us = voice("Samantha", "en-US", true);
    const vi = voice("Linh", "vi-VN", true);
    expect(pickVoice([remote, vi])).toBeNull();
    expect(pickVoice([remote, uk, us, vi])).toBe(us);
    expect(pickVoice([remote, uk, us], "Daniel")).toBe(uk);
    expect(pickVoice([uk, us], "Google US English")).toBe(us);
    expect(pickVoice([uk])).toBe(uk);
  });

  it("bài phỏng vấn: chọn đúng vùng Mỹ/Anh/Ấn Độ nếu máy có; không có thì giọng khác và báo không đúng vùng; giọng mạng không dùng", () => {
    const us = voice("Samantha", "en-US", true);
    const uk = voice("Daniel", "en_GB", true);
    const inRemote = voice("Google Hindi English", "en-IN", false);
    const inLocal = voice("Rishi", "en-IN", true);
    expect(pickAccentVoice([us, uk, inLocal], "IN")).toEqual({ voice: inLocal, exact: true });
    expect(pickAccentVoice([us, uk], "GB")).toEqual({ voice: uk, exact: true });
    expect(pickAccentVoice([us, uk, inRemote], "IN")).toEqual({ voice: us, exact: false });
    expect(pickAccentVoice([inRemote], "US")).toBeNull();
  });

  it("giọng tiếng Việt chỉ lấy giọng trên máy; khóa lưu mới không trùng khóa cũ me.voice", () => {
    expect(pickVietnameseVoice([voice("Linh", "vi-VN", true)])?.name).toBe("Linh");
    expect(pickVietnameseVoice([voice("Google Tiếng Việt", "vi-VN", false)])).toBeNull();
    expect(new Set([VOICE_KEY, ACCENT_KEY, RATE_KEY]).size).toBe(3);
  });
});
