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

// ===== Bài luyện phỏng vấn (2026-11-25-engine-cadet-interview): chọn theo vùng giọng, khóa lưu riêng, không đụng VOICE_KEY =====

export type Accent = "US" | "GB" | "IN";
export const ACCENTS_UI: { id: Accent; label: string; lang: string }[] = [
  { id: "US", label: "Mỹ", lang: "en-US" },
  { id: "GB", label: "Anh", lang: "en-GB" },
  { id: "IN", label: "Ấn Độ", lang: "en-IN" },
];
export const ACCENT_KEY = "me.voice.accent";
export const RATE_KEY = "me.voice.rate";
export const RATES = { slow: 0.7, normal: 0.95 } as const;

const langOf = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();

/** Giọng cục bộ đúng vùng (exact) nếu máy có; không thì giọng tiếng Anh cục bộ khác (theo pickVoice); không có giọng nào → null. */
export function pickAccentVoice(voices: SpeechSynthesisVoice[], accent: Accent): { voice: SpeechSynthesisVoice; exact: boolean } | null {
  const want = ACCENTS_UI.find((a) => a.id === accent)!.lang.toLowerCase();
  const exact = englishLocalVoices(voices).find((v) => langOf(v) === want);
  if (exact) return { voice: exact, exact: true };
  const other = pickVoice(voices);
  return other ? { voice: other, exact: false } : null;
}

/** Giọng tiếng Việt cài trên máy (cho lời dẫn); không có → null (chỉ hiện chữ). */
export function pickVietnameseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find((v) => v.localService && langOf(v).startsWith("vi")) ?? null;
}
