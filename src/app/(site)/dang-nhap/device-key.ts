// Khóa thiết bị: 32 byte ngẫu nhiên, base64url, lưu bền trong IndexedDB (dự phòng localStorage).
// Đăng xuất bình thường giữ khóa; đổi tài khoản thì xóa để lần sau sinh khóa mới.
const DB = "marine-english";
const STORE = "kv";
const KEY = "device-key";

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDeviceKey(): Promise<string> {
  try {
    const stored = await idb<string | undefined>("readonly", (s) => s.get(KEY));
    if (stored) return stored;
    const key = newKey();
    await idb("readwrite", (s) => s.put(key, KEY));
    return key;
  } catch {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const key = newKey();
    localStorage.setItem(KEY, key);
    return key;
  }
}

export async function forgetDeviceKey(): Promise<void> {
  localStorage.removeItem(KEY);
  try {
    await idb("readwrite", (s) => s.delete(KEY));
  } catch {
    // IndexedDB không dùng được thì khóa chỉ nằm ở localStorage, đã xóa ở trên.
  }
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Điện thoại Android";
  return "Máy tính";
}
