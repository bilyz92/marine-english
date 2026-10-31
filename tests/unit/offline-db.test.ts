import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { advanceMaxSeen, dbGet, deleteOfflineDb, openOfflineDb } from "@/lib/offline/db";

const who = () => ({ userId: `u${Math.random()}`, deviceId: "d1" });

describe("mốc thời gian lớn nhất trên máy (Codex P3 vòng 3)", () => {
  it("chỉ tăng: thấy giờ quá hạn rồi đồng hồ bị chỉnh lùi → vẫn giữ mốc lớn", async () => {
    const w = who();
    expect(await advanceMaxSeen(w, 1_000)).toBe(1_000);
    expect(await advanceMaxSeen(w, 500)).toBe(1_000);
    expect(await dbGet<number>(await openOfflineDb(w), "kv", "maxSeen")).toBe(1_000);
  });

  it("nhiều lần ghi song song → giữ giá trị lớn nhất, không bị ghi đè bằng giá trị cũ", async () => {
    const w = who();
    const values = [5, 900, 100, 700, 300, 899, 1];
    await Promise.all(values.map((v) => advanceMaxSeen(w, v)));
    expect(await dbGet<number>(await openOfflineDb(w), "kv", "maxSeen")).toBe(900);
  });

  it("xóa kho thật sự xóa dữ liệu", async () => {
    const w = who();
    await advanceMaxSeen(w, 42);
    await deleteOfflineDb(w);
    expect(await dbGet<number>(await openOfflineDb(w), "kv", "maxSeen")).toBeUndefined();
  });
});
