import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { dbGet, deleteOfflineDb, openOfflineDb } from "@/lib/offline/db";
import { evictions, MAX_RECORDINGS, memoryStore, offlineStore, type Recording } from "@/lib/study/recordings";

// Bản thu chỉ trên máy (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 5).

const who = () => ({ userId: `u${Math.random()}`, deviceId: "d1" });
const rec = (key: string, at: number, lessonId = "EC-001"): Recording => ({ key, lessonId, bytes: new Uint8Array([1, 2, 3]).buffer, mime: "audio/webm", ms: 1200, at });

describe("kho bản thu", () => {
  it("lưu, đọc, thay (cùng khóa), xóa", async () => {
    const store = offlineStore(who());
    await store.put(rec("EC-001|L1|first|aaa", 1));
    expect((await store.get("EC-001|L1|first|aaa"))?.ms).toBe(1200);
    expect(new Uint8Array((await store.get("EC-001|L1|first|aaa"))!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    await store.put({ ...rec("EC-001|L1|first|aaa", 2), ms: 900 });
    expect((await store.get("EC-001|L1|first|aaa"))?.ms).toBe(900);
    await store.remove("EC-001|L1|first|aaa");
    expect(await store.get("EC-001|L1|first|aaa")).toBeUndefined();
  });

  it("giới hạn số bản: quá thì xóa bản cũ nhất", async () => {
    expect(evictions([{ key: "a", at: 3 }, { key: "b", at: 1 }, { key: "c", at: 2 }], 2)).toEqual(["b"]);
    expect(evictions([{ key: "a", at: 1 }], 2)).toEqual([]);
    const store = offlineStore(who());
    for (let i = 0; i < MAX_RECORDINGS + 2; i++) await store.put(rec(`k${i}`, i));
    expect(await store.get("k0")).toBeUndefined();
    expect(await store.get("k1")).toBeUndefined();
    expect(await store.get("k2")).toBeDefined();
  });

  it("prune xóa bản thu của chữ cũ trong đúng bài; clearAll xóa hết", async () => {
    const store = offlineStore(who());
    await store.put(rec("EC-001|L1|first|old", 1));
    await store.put(rec("EC-001|L1|first|new", 2));
    await store.put(rec("EC-002|L1|first|x", 3, "EC-002"));
    await store.prune("EC-001", new Set(["EC-001|L1|first|new"]));
    expect(await store.get("EC-001|L1|first|old")).toBeUndefined();
    expect(await store.get("EC-001|L1|first|new")).toBeDefined();
    expect(await store.get("EC-002|L1|first|x")).toBeDefined();
    await store.clearAll();
    expect(await store.get("EC-002|L1|first|x")).toBeUndefined();
  });

  it("xóa kho học trên máy (đăng xuất, đổi người, máy bị gỡ) xóa cả bản thu", async () => {
    const w = who();
    await offlineStore(w).put(rec("EC-001|L3|advanced|a", 1));
    await deleteOfflineDb(w);
    expect(await offlineStore(w).get("EC-001|L3|advanced|a")).toBeUndefined();
  });

  it("nâng kho từ phiên bản 2: giữ dữ liệu cũ, có thêm kho bản thu", async () => {
    const w = who();
    const name = `me-offline-${w.userId}-${w.deviceId}`;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.onupgradeneeded = () => {
        for (const s of ["kv", "lessons", "files", "queue", "quarantine", "videos", "videoParts"]) req.result.createObjectStore(s);
        req.result.createObjectStore("x-unused");
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(7, "lastSeq");
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
    const db = await openOfflineDb(w);
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains("recordings")).toBe(true);
    expect(await dbGet<number>(db, "kv", "lastSeq")).toBe(7);
  });

  it("khách: chỉ trong bộ nhớ, không ghi gì xuống máy", async () => {
    const before = (await indexedDB.databases()).length;
    const store = memoryStore();
    expect(store.persistent).toBe(false);
    await store.put(rec("EC-001|L1|first|a", 1));
    expect(await store.get("EC-001|L1|first|a")).toBeDefined();
    expect((await indexedDB.databases()).length).toBe(before);
    expect(await memoryStore().get("EC-001|L1|first|a")).toBeUndefined();
  });
});
