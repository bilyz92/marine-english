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

export function openOfflineDb(who: { userId: string; deviceId: string }): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(who), 1);
    req.onupgradeneeded = () => {
      for (const name of STORES) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteOfflineDb(who: { userId: string; deviceId: string }): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(who));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
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
