import { openOfflineDb } from "@/lib/offline/db";

// Bản thu của học viên ở bài luyện phỏng vấn (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Quyết định 10, Task 5).
// Chỉ lưu trên máy, không bao giờ gửi đi. Học viên: kho IndexedDB của chính người đó trên máy này (xóa cùng kho khi đăng xuất,
// đổi người, máy bị gỡ). Khách học thử: chỉ trong bộ nhớ trang (máy có thể dùng chung), rời trang là mất.

export type Recording = { key: string; lessonId: string; bytes: ArrayBuffer; mime: string; ms: number; at: number };
export type RecordingStore = {
  /** true: còn sau khi tải lại trang. */
  persistent: boolean;
  get(key: string): Promise<Recording | undefined>;
  put(rec: Recording): Promise<void>;
  remove(key: string): Promise<void>;
  /** Xóa bản thu của bài không còn khớp đích nào hiện có (chữ đổi, hồ sơ đổi). */
  prune(lessonId: string, keep: Set<string>): Promise<void>;
  clearAll(): Promise<void>;
};

export const MAX_RECORDINGS = 150;
export const MAX_RECORDING_MS = 120_000;

/** Khóa cần xóa để còn tối đa `max` bản: bỏ bản cũ nhất trước. */
export function evictions(all: { key: string; at: number }[], max = MAX_RECORDINGS): string[] {
  if (all.length <= max) return [];
  return [...all].sort((a, b) => a.at - b.at).slice(0, all.length - max).map((r) => r.key);
}

export function memoryStore(): RecordingStore {
  const m = new Map<string, Recording>();
  return {
    persistent: false,
    get: async (key) => m.get(key),
    put: async (rec) => {
      m.set(rec.key, rec);
      for (const k of evictions([...m.values()])) m.delete(k);
    },
    remove: async (key) => void m.delete(key),
    prune: async (lessonId, keep) => {
      for (const r of [...m.values()]) if (r.lessonId === lessonId && !keep.has(r.key)) m.delete(r.key);
    },
    clearAll: async () => m.clear(),
  };
}

/** Chạy một thao tác trên kho bản thu trong một giao dịch, xong khi giao dịch hoàn tất. */
function inStore<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", mode);
    const req = run(tx.objectStore("recordings"));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function offlineStore(who: { userId: string; deviceId: string }): RecordingStore {
  const db = () => openOfflineDb(who);
  return {
    persistent: true,
    get: async (key) => (await inStore<Recording>(await db(), "readonly", (s) => s.get(key) as IDBRequest<Recording>)) ?? undefined,
    put: async (rec) => {
      // Ghi rồi bỏ bản cũ nhất theo chỉ mục thời điểm (chỉ đọc khóa, không đọc âm thanh), trong cùng giao dịch.
      await inStore(await db(), "readwrite", (s) => {
        s.put(rec, rec.key);
        const count = s.count();
        count.onsuccess = () => {
          let extra = count.result - MAX_RECORDINGS;
          if (extra <= 0) return;
          const cursor = s.index("at").openKeyCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c || extra <= 0) return;
            s.delete(c.primaryKey);
            extra -= 1;
            c.continue();
          };
        };
      });
    },
    remove: async (key) => void (await inStore(await db(), "readwrite", (s) => s.delete(key))),
    prune: async (lessonId, keep) => {
      const d = await db();
      const keys = ((await inStore(d, "readonly", (s) => s.getAllKeys())) ?? []) as string[];
      const stale = keys.filter((k) => k.startsWith(`${lessonId}|`) && !keep.has(k));
      if (stale.length) await inStore(d, "readwrite", (s) => { for (const k of stale) s.delete(k); });
    },
    clearAll: async () => void (await inStore(await db(), "readwrite", (s) => s.clear())),
  };
}
