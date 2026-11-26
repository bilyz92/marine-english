"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import learn from "@/app/hoc/learn.module.css";
import { ACCENT_KEY, ACCENTS_UI, pickAccentVoice, pickVietnameseVoice, RATE_KEY, RATES, type Accent } from "@/lib/client/speech";
import { MAX_RECORDING_MS, type RecordingStore } from "@/lib/study/recordings";
import { useVoices } from "../speak";
import styles from "./study.module.css";

// Giọng mẫu trên máy và ghi âm trên máy cho bài luyện phỏng vấn (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, QĐ 9–10).
// Không gửi chữ hay âm thanh đi đâu: giọng đọc chỉ dùng giọng cài trên máy (localService), bản thu chỉ vào kho trên máy.

const readPref = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* bị chặn: vẫn dùng được trong lượt này */
  }
};

export type Speaker = ReturnType<typeof useSpeaker>;

/** Một giọng mẫu cho cả bài: mỗi lúc phát một câu; đổi giọng thì phát lại đúng câu đang chọn. */
export function useSpeaker() {
  const voices = useVoices();
  const [accent, setAccentState] = useState<Accent>(() => (ACCENTS_UI.some((a) => a.id === readPref(ACCENT_KEY)) ? (readPref(ACCENT_KEY) as Accent) : "US"));
  const [slow, setSlowState] = useState(() => readPref(RATE_KEY) === "slow");
  const [playing, setPlaying] = useState<string | null>(null);
  const last = useRef<{ id: string; text: string; lang: "en" | "vi" } | null>(null);
  // Câu đang đọc: cancel() làm câu cũ báo lỗi "interrupted" muộn; chỉ câu hiện tại mới được tắt trạng thái đang đọc.
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const en = pickAccentVoice(voices, accent);
  const vi = pickVietnameseVoice(voices);
  const supported = typeof window !== "undefined" && !!window.speechSynthesis;

  const stop = useCallback(() => {
    current.current = null;
    if (supported) window.speechSynthesis.cancel();
    setPlaying(null);
  }, [supported]);

  const play = useCallback((id: string, text: string, lang: "en" | "vi" = "en", opts: { accent?: Accent; slow?: boolean } = {}) => {
    if (!supported || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const voice = lang === "vi" ? pickVietnameseVoice(synth.getVoices()) : pickAccentVoice(synth.getVoices(), opts.accent ?? accent)?.voice;
    if (!voice) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = (opts.slow ?? slow) ? RATES.slow : RATES.normal;
    const done = () => {
      if (current.current !== u) return;
      current.current = null;
      setPlaying((p) => (p === id ? null : p));
    };
    u.onend = done;
    u.onerror = done;
    current.current = u;
    last.current = { id, text, lang };
    setPlaying(id);
    synth.speak(u);
  }, [supported, accent, slow]);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return {
    accent, slow, playing, hasEnglish: !!en, exact: !!en?.exact, voiceLang: en?.voice.lang ?? null, hasVietnamese: !!vi,
    play, stop,
    setAccent(a: Accent) {
      setAccentState(a);
      writePref(ACCENT_KEY, a);
      // Đổi giọng: phát lại câu tiếng Anh đang chọn bằng giọng mới (Giọng đọc: "Phát lại đoạn đang chọn").
      const l = last.current;
      if (l && l.lang === "en" && playing) play(l.id, l.text, "en", { accent: a });
    },
    setSlow(s: boolean) {
      setSlowState(s);
      writePref(RATE_KEY, s ? "slow" : "normal");
      // Đổi tốc độ khi đang đọc: đọc lại câu đó ngay ở tốc độ mới, như đổi giọng (chủ 26/11/2026: bấm Chậm không thấy đổi).
      const l = last.current;
      if (l && playing) play(l.id, l.text, l.lang, { slow: s });
    },
  };
}

export function VoiceBar({ speaker }: { speaker: Speaker }) {
  const label = ACCENTS_UI.find((a) => a.id === speaker.accent)!.label;
  return (
    <div className={styles.voiceBar}>
      <div className={styles.seg} role="group" aria-label="Giọng đọc mẫu">
        {ACCENTS_UI.map((a) => (
          <button key={a.id} type="button" className={a.id === speaker.accent ? styles.segOn : styles.segBtn} aria-pressed={a.id === speaker.accent} onClick={() => speaker.setAccent(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className={styles.seg} role="group" aria-label="Tốc độ đọc">
        <button type="button" className={speaker.slow ? styles.segOn : styles.segBtn} aria-pressed={speaker.slow} onClick={() => speaker.setSlow(true)}>Chậm</button>
        <button type="button" className={!speaker.slow ? styles.segOn : styles.segBtn} aria-pressed={!speaker.slow} onClick={() => speaker.setSlow(false)}>Thường</button>
      </div>
      {!speaker.hasEnglish ? (
        <p className={learn.muted} role="status">Máy này chưa có giọng đọc tiếng Anh nên không có nút Nghe. Vẫn đọc chữ và ghi âm được.</p>
      ) : !speaker.exact ? (
        <p className={learn.muted} role="status">Máy chưa có giọng {label}, đang đọc bằng giọng {speaker.voiceLang}.</p>
      ) : null}
    </div>
  );
}

/** Nút Nghe / Dừng cho một câu. Không có giọng phù hợp trên máy thì không hiện. */
export function Listen({ speaker, id, text, lang = "en", label = "Nghe", skipped }: { speaker: Speaker; id: string; text: string; lang?: "en" | "vi"; label?: string; skipped?: boolean }) {
  if (!text || (lang === "en" ? !speaker.hasEnglish : !speaker.hasVietnamese)) return null;
  const on = speaker.playing === id;
  return (
    <span className={learn.speak}>
      <button type="button" className={learn.secondary} aria-pressed={on} onClick={() => (on ? speaker.stop() : speaker.play(id, text, lang))}>{on ? "Dừng" : label}</button>
      {skipped && <span className={learn.muted}>Máy bỏ qua phần bạn chưa điền.</span>}
    </span>
  );
}

// ===== Ghi âm =====

type MicProblem = "denied" | "unsupported" | "failed" | "storage";
const PROBLEM_TEXT: Record<MicProblem, string> = {
  denied: "Bạn chưa cho trang này dùng micro. Vẫn nghe và đọc mẫu được. Muốn ghi âm: bật quyền micro cho trang trong cài đặt trình duyệt rồi bấm Ghi âm lại.",
  unsupported: "Trình duyệt này không ghi âm được. Vẫn nghe và đọc mẫu được; muốn ghi âm hãy mở app bằng Chrome (Android) hoặc Safari (iPhone).",
  failed: "Không mở được micro (máy đang dùng micro cho việc khác?). Vẫn nghe và đọc mẫu được.",
  storage: "Không lưu được bản thu trên máy (bộ nhớ đầy hoặc trình duyệt chặn). Thử xóa bớt bản thu cũ.",
};

export type Recorder = ReturnType<typeof useRecorder>;

/** Một máy ghi cho cả bài. Mọi đường kết thúc đều tắt micro (dừng mọi track), hủy hẹn giờ. */
export function useRecorder(store: RecordingStore) {
  const [active, setActive] = useState<string | null>(null);
  const [problem, setProblem] = useState<MicProblem | null>(null);
  const [version, setVersion] = useState(0);
  const session = useRef<{ key: string; recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout>; keep: boolean } | null>(null);
  /** Lần thu đang xin quyền micro: bị hủy trước khi có micro thì tắt luôn track khi có. */
  const pending = useRef<string | null>(null);

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    clearTimeout(s.timer);
    for (const t of s.stream.getTracks()) t.stop();
    session.current = null;
  }, []);

  const cancel = useCallback(() => {
    pending.current = null;
    const s = session.current;
    if (s) {
      s.keep = false;
      if (s.recorder.state !== "inactive") s.recorder.stop();
      release();
    }
    setActive(null);
  }, [release]);

  const stop = useCallback(() => {
    const s = session.current;
    if (s && s.recorder.state !== "inactive") s.recorder.stop();
  }, []);

  const start = useCallback(async (key: string, lessonId: string, onSaved: (key: string) => void) => {
    cancel();
    setProblem(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setProblem("unsupported");
    pending.current = key;
    setActive(key);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      pending.current = null;
      setActive(null);
      return setProblem((error as { name?: string })?.name === "NotAllowedError" || (error as { name?: string })?.name === "SecurityError" ? "denied" : "failed");
    }
    if (pending.current !== key) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    pending.current = null;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      setActive(null);
      return setProblem("unsupported");
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const keep = session.current?.recorder === recorder ? session.current.keep : false;
      if (session.current?.recorder === recorder) release();
      setActive((a) => (a === key ? null : a));
      if (!keep || !chunks.length) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]!.type || "audio/webm" });
      try {
        await store.put({ key, lessonId, bytes: await blob.arrayBuffer(), mime: blob.type, ms: Date.now() - startedAt, at: Date.now() });
      } catch {
        return setProblem("storage");
      }
      setVersion((v) => v + 1);
      onSaved(key);
    };
    recorder.onerror = () => {
      cancel();
      setProblem("failed");
    };
    session.current = { key, recorder, stream, keep: true, timer: setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, MAX_RECORDING_MS) };
    try {
      recorder.start();
    } catch {
      // Không bắt đầu thu được: tắt micro, hủy hẹn giờ, không treo ở "Đang ghi âm".
      if (session.current) session.current.keep = false;
      release();
      setActive(null);
      setProblem("failed");
    }
  }, [cancel, release, store]);

  // Rời bài: dừng thu, tắt micro, không lưu bản dở.
  useEffect(() => () => cancel(), [cancel]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { active, problem, problemText: problem ? PROBLEM_TEXT[problem] : null, version, start, stop, cancel, refresh, store };
}

/** Các nút ghi âm của một đích: Ghi âm / Dừng; sau khi có bản thu: Nghe giọng mình, Nghe mẫu, Thu lại, Xóa. */
export function RecordPanel({ recorder, speaker, recKey, lessonId, sample, sampleId, onRecorded, hint }: {
  recorder: Recorder; speaker: Speaker; recKey: string; lessonId: string; sample: string; sampleId: string; onRecorded: (key: string) => void; hint?: string;
}) {
  const [has, setHas] = useState(false);
  const [playingOwn, setPlayingOwn] = useState(false);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
  const recording = recorder.active === recKey;

  const stopOwn = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    a.el.pause();
    URL.revokeObjectURL(a.url);
    audio.current = null;
    setPlayingOwn(false);
  }, []);

  useEffect(() => {
    let stale = false;
    void recorder.store.get(recKey).then((r) => { if (!stale) setHas(!!r); }).catch(() => { if (!stale) setHas(false); });
    return () => { stale = true; };
  }, [recorder.store, recKey, recorder.version]);

  // Đổi đích hoặc rời màn: dừng phát bản thu, thu hồi URL; đang thu đích này thì hủy (tắt micro).
  const { cancel, active } = recorder;
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => () => {
    stopOwn();
    if (activeRef.current === recKey) cancel();
  }, [recKey, stopOwn, cancel]);

  async function playOwn() {
    if (playingOwn) return stopOwn();
    speaker.stop();
    const r = await recorder.store.get(recKey);
    if (!r) return setHas(false);
    stopOwn();
    const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
    const el = new Audio(url);
    el.onended = stopOwn;
    el.onerror = stopOwn;
    audio.current = { el, url };
    setPlayingOwn(true);
    void el.play().catch(stopOwn);
  }

  async function remove() {
    stopOwn();
    await recorder.store.remove(recKey).catch(() => undefined);
    setHas(false);
  }

  function record() {
    stopOwn();
    speaker.stop();
    void recorder.start(recKey, lessonId, onRecorded);
  }

  return (
    <div className={styles.rec} data-rec={recKey}>
      {hint && <p className={learn.muted}>{hint}</p>}
      <div className={learn.actions}>
        {recording ? (
          <button type="button" className={styles.recOn} onClick={recorder.stop}>Dừng ghi âm</button>
        ) : (
          <button type="button" className={learn.secondary} onClick={record}>{has ? "Thu lại" : "Ghi âm"}</button>
        )}
        {has && !recording && (
          <>
            <button type="button" className={learn.secondary} aria-pressed={playingOwn} onClick={() => void playOwn()}>{playingOwn ? "Dừng nghe" : "Nghe giọng mình"}</button>
            <Listen speaker={speaker} id={sampleId} text={sample} label="Nghe mẫu" />
            <button type="button" className={learn.secondary} onClick={() => void remove()}>Xóa bản thu</button>
          </>
        )}
      </div>
      {recording && <p className={styles.recLive} role="status">Đang ghi âm… đọc to rồi bấm Dừng (tối đa 2 phút).</p>}
    </div>
  );
}
