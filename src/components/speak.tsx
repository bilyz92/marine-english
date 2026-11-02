"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "@/app/hoc/learn.module.css";
import { englishLocalVoices, pickVoice, speakableText, VOICE_KEY } from "@/lib/client/speech";

// Nút "Nghe" đọc tiếng Anh bằng giọng cài trên máy. Không có giọng tiếng Anh cục bộ thì không hiện nút.

// Một kho giọng chung cho mọi nút: trình duyệt thường trả danh sách rỗng lúc đầu rồi báo "voiceschanged" một lần,
// nên khi danh sách đổi phải báo cho MỌI thành phần đang dùng.
const NO_VOICES: SpeechSynthesisVoice[] = [];
let cached: SpeechSynthesisVoice[] = NO_VOICES;
const listeners = new Set<() => void>();

function refresh() {
  const next = window.speechSynthesis.getVoices();
  if (next.length === cached.length && next.every((v, i) => v === cached[i])) return;
  cached = next.length ? next : NO_VOICES;
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.speechSynthesis) return () => {};
  if (!listeners.size) window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
  listeners.add(onChange);
  refresh();
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
  };
}

const snapshot = () => cached;
const serverSnapshot = () => NO_VOICES;
const useVoices = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);

function readPreferred(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}

export function SpeakButton({ text, label = "Nghe" }: { text?: string; label?: string }) {
  const voices = useVoices();
  const [speaking, setSpeaking] = useState(false);
  const { text: spoken, hadBlanks } = speakableText(text ?? "");
  if (!spoken || !pickVoice(voices)) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) return setSpeaking(false);
    const voice = pickVoice(synth.getVoices(), readPreferred());
    if (!voice) return;
    const u = new SpeechSynthesisUtterance(spoken);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  return (
    <span className={styles.speak}>
      <button type="button" className={styles.secondary} onClick={toggle} aria-pressed={speaking}>{speaking ? "Dừng" : label}</button>
      {hadBlanks && <span className={styles.muted}> Máy bỏ qua phần trong ngoặc [ ] (thông tin riêng tự điền).</span>}
    </span>
  );
}

/** Chọn giọng đọc (Mỹ, Anh, Philippines, Ấn… tùy giọng cài trên máy), nhớ trên máy này. */
export function VoicePicker() {
  const voices = englishLocalVoices(useVoices());
  const [preferred, setPreferred] = useState<string | null>(() => (typeof window === "undefined" ? null : readPreferred()));
  if (!voices.length) return null;
  const current = pickVoice(voices, preferred);
  return (
    <label className={styles.voice}>
      <span className={styles.muted}>Giọng đọc (có sẵn trên máy)</span>
      <select
        value={current?.voiceURI ?? ""}
        onChange={(e) => {
          setPreferred(e.target.value);
          try {
            localStorage.setItem(VOICE_KEY, e.target.value);
          } catch {
            /* trình duyệt chặn lưu: vẫn dùng được giọng mặc định */
          }
        }}
      >
        {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
      </select>
    </label>
  );
}
