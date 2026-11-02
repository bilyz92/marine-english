// Đọc tiếng Anh bằng giọng cài sẵn trên máy (Web Speech API). Chỉ dùng giọng localService: giọng dịch vụ mạng
// có thể gửi chữ ra ngoài. Không phải chấm phát âm (cần dịch vụ riêng, chưa có).

export const VOICE_KEY = "me.voice";
const ACCENTS = ["en-US", "en-GB", "en-PH", "en-IN", "en-AU"];

/** Bỏ chỗ trống [..] chưa điền (tên, tuổi…): máy không đọc nhãn kỹ thuật. */
export function speakableText(text: string): { text: string; hadBlanks: boolean } {
  const hadBlanks = /\[[^\]]*\]/.test(text);
  const cleaned = text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(?:\s*[.,;:!?])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: /^[\s.,;:!?]*$/.test(cleaned) ? "" : cleaned, hadBlanks };
}

/** Giọng tiếng Anh cục bộ: giọng đã chọn nếu còn, rồi theo thứ tự giọng Mỹ, Anh, Philippines, Ấn, Úc. */
export function pickVoice(voices: SpeechSynthesisVoice[], preferred?: string | null): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));
  if (!local.length) return null;
  const chosen = preferred ? local.find((v) => v.voiceURI === preferred || v.name === preferred) : undefined;
  if (chosen) return chosen;
  for (const accent of ACCENTS) {
    const v = local.find((x) => x.lang.replace("_", "-").toLowerCase() === accent.toLowerCase());
    if (v) return v;
  }
  return local[0]!;
}

export function englishLocalVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));
}
