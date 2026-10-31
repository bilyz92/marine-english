// Kho IndexedDB của một học viên trên một máy: tên DB gồm sub + did để dữ liệu người này không lẫn sang người khác.

export type StoreName = "kv" | "lessons" | "files" | "queue" | "quarantine";
const STORES: StoreName[] = ["kv", "lessons", "files", "queue", "quarantine"];

export type Identity = { userId: string; deviceId: string; displayName: string };

const dbName = (who: { userId: string; deviceId: string }) => `me-offline-${who.userId}-${who.deviceId}`;

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Một kết nối cho mỗi kho trong tab này; tab khác xóa kho thì kết nối tự đóng (versionchange) để việc xóa không bị chặn.
const connections = new Map<string, Promise<IDBDatabase>>();

export function openOfflineDb(who: { userId: string; deviceId: string }): Promise<IDBDatabase> {
  const name = dbName(who);
  let pending = connections.get(name);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        for (const store of STORES) req.result.createObjectStore(store);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          connections.delete(name);
        };
        resolve(db);
      };
      req.onerror = () => {
        connections.delete(name);
        reject(req.error);
      };
    });
    connections.set(name, pending);
  }
  return pending;
}

const DELETE_TIMEOUT_MS = 10_000;

/** Xóa hẳn kho của một người: đóng kết nối trong tab này, chờ tab khác đóng; chỉ báo xong khi trình duyệt xác nhận đã xóa. */
export async function deleteOfflineDb(who: { userId: string; deviceId: string }): Promise<void> {
  const name = dbName(who);
  const open = connections.get(name);
  connections.delete(name);
  if (open) (await open.catch(() => null))?.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => reject(new Error("Chưa xóa được dữ liệu học trên máy: còn tab khác đang mở app")), DELETE_TIMEOUT_MS);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
  });
}

export const dbGet = <T>(db: IDBDatabase, store: StoreName, key: string): Promise<T | undefined> =>
  promised(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;

export const dbGetAll = <T>(db: IDBDatabase, store: StoreName): Promise<T[]> =>
  promised(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;

export const dbPut = (db: IDBDatabase, store: StoreName, key: string, value: unknown): Promise<IDBValidKey> =>
  promised(db.transaction(store, "readwrite").objectStore(store).put(value, key));

export const dbDelete = (db: IDBDatabase, store: StoreName, key: string): Promise<undefined> =>
  promised(db.transaction(store, "readwrite").objectStore(store).delete(key));

/** Cấp số thứ tự và ghi sự kiện trong một transaction, để hai thao tác liền nhau không trùng seq. */
export function enqueueWithSeq<T extends { eventId: string }>(db: IDBDatabase, build: (lastSeq: number) => T & { seq: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["kv", "queue"], "readwrite");
    const kv = tx.objectStore("kv");
    const get = kv.get("lastSeq");
    let built: T & { seq: number };
    get.onsuccess = () => {
      built = build((get.result as number | undefined) ?? 0);
      kv.put(built.seq, "lastSeq");
      tx.objectStore("queue").put(built, built.eventId);
    };
    tx.oncomplete = () => resolve(built);
    tx.onerror = () => reject(tx.error);
  });
}
