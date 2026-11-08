// Lưu trên máy cho giao diện 3 mức: hồ sơ, mức đang chọn, bước, bản nháp. Học viên đã đăng nhập: localStorage theo mã
// học viên, xóa khi đăng xuất (clearStudyData). Trang học thử ("khach", máy có thể dùng chung): chỉ sessionStorage,
// đóng trình duyệt là mất. Trình duyệt chặn lưu thì vẫn học được, chỉ không nhớ.
export const GUEST = "khach";
const store = (who: string): Storage => (who === GUEST ? sessionStorage : localStorage);
import type { LevelId } from "./levels";
import type { Profile } from "./personalize";

export type LessonState = {
  level?: LevelId;
  step?: number;
  /** Bản nháp theo mức; `essay` là bài tự luận (2026-11-08-course-modules). */
  drafts?: Partial<Record<LevelId | "essay", string>>;
  said?: Partial<Record<LevelId, boolean>>;
  /** Bài tập: câu trả lời và đã bấm Kiểm tra chưa, theo mã bài tập. */
  exercises?: Record<string, { value: string; checked: boolean }>;
};

function read<T>(who: string, key: string, fallback: T): T {
  try {
    const raw = store(who).getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(who: string, key: string, value: unknown): void {
  try {
    store(who).setItem(key, JSON.stringify(value));
  } catch {
    /* hết chỗ hoặc bị chặn: bỏ qua */
  }
}

export const loadProfile = (who: string) => read<Profile>(who, `me.profile.${who}`, {});
export const saveProfile = (who: string, profile: Profile) => write(who, `me.profile.${who}`, profile);
export const loadLessonState = (who: string, lessonId: string) => read<LessonState>(who, `me.study.${who}.${lessonId}`, {});
export const saveLessonState = (who: string, lessonId: string, state: LessonState) => write(who, `me.study.${who}.${lessonId}`, state);
/** Ghép thay đổi vào trạng thái đang lưu (giữ mức, bước, bài tập…), không ghi đè cả bài. */
export function updateLessonState(who: string, lessonId: string, patch: Partial<LessonState>): LessonState {
  const next = { ...loadLessonState(who, lessonId), ...patch };
  saveLessonState(who, lessonId, next);
  return next;
}
export const loadAccountLevel = (who: string) => read<string | null>(who, `me.study.${who}.level`, null);
export const saveAccountLevel = (who: string, level: LevelId) => write(who, `me.study.${who}.level`, level);

/** Đăng xuất: xóa hồ sơ (tên, tuổi, kinh nghiệm…), mức và bản nháp của học viên này trên máy. */
export function clearStudyData(userId: string): void {
  try {
    const prefixes = [`me.profile.${userId}`, `me.study.${userId}.`];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && prefixes.some((p) => key === p || key.startsWith(p))) localStorage.removeItem(key);
    }
  } catch {
    /* bị chặn: không có gì để xóa */
  }
}
