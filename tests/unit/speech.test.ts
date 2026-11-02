import { describe, expect, it } from "vitest";
import { pickVoice, speakableText } from "@/lib/client/speech";

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
});
