import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRangeResponse, downloadInChunks, staleVideoIds } from "@/lib/offline/video-download";

// Tải video về máy theo từng đoạn Range (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 3).

const FILE = new Uint8Array(Array.from({ length: 25 }, (_, i) => i));
const SHA = createHash("sha256").update(FILE).digest("hex");

/** Kho giả: đoạn chỉ ghi được khi video còn "được giữ" (mô phỏng điều kiện còn trong manifest của engine). */
function store() {
  const parts = new Map<number, Uint8Array>();
  const s = {
    parts, kept: true, finished: false, fetched: [] as [number, number][],
    getPart: async (n: number) => parts.get(n),
    putPart: async (n: number, b: Uint8Array) => { if (!s.kept) return false; parts.set(n, b); return true; },
    finish: async () => { if (!s.kept) return false; s.finished = true; return true; },
    deleteParts: async (count: number) => { for (let n = 0; n < count; n++) parts.delete(n); },
  };
  return s;
}
const fetchFrom = (s: ReturnType<typeof store>, file = FILE, fail?: (start: number) => boolean) => async (start: number, end: number) => {
  s.fetched.push([start, end]);
  if (fail?.(start)) throw new Error("mất mạng");
  return file.slice(start, end + 1);
};

describe("tải video theo đoạn", () => {
  it("tải đủ từ đầu: 3 đoạn, đúng các khoảng Range, sha đúng → done", async () => {
    const s = store();
    const progress: number[] = [];
    const out = await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s), ...s, onProgress: (d) => progress.push(d) });
    expect(out).toBe("done");
    expect(s.fetched).toEqual([[0, 9], [10, 19], [20, 24]]);
    expect(s.finished).toBe(true);
    expect(progress.at(-1)).toBe(25);
  });

  it("đứt mạng ở đoạn 2 → failed, giữ đoạn 1; lần sau chỉ tải đoạn 2–3", async () => {
    const s = store();
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s, FILE, (st) => st === 10), ...s })).toBe("failed");
    expect([...s.parts.keys()]).toEqual([0]);
    s.fetched = [];
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s), ...s })).toBe("done");
    expect(s.fetched).toEqual([[10, 19], [20, 24]]);
  });

  it("phản hồi không hợp lệ (null) → failed", async () => {
    const s = store();
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: async () => null, ...s })).toBe("failed");
    expect(s.finished).toBe(false);
  });

  it("sai sha256 → hash_mismatch, xóa mọi đoạn, không đánh dấu xong", async () => {
    const s = store();
    const other = FILE.map((b) => b ^ 1);
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s, other), ...s })).toBe("hash_mismatch");
    expect(s.parts.size).toBe(0);
    expect(s.finished).toBe(false);
  });

  it("video bị dọn trong lúc đang tải (khóa thu hồi, video bị thay) → cancelled, không còn đoạn nào", async () => {
    const s = store();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const pending = downloadInChunks({
      size: 25, sha256: SHA, chunkBytes: 10, ...s,
      fetchRange: async (start, end) => { if (start === 10) await gate; return FILE.slice(start, end + 1); },
    });
    await new Promise((r) => setTimeout(r, 0));
    s.kept = false;
    s.parts.clear();
    release();
    expect(await pending).toBe("cancelled");
    expect(s.parts.size).toBe(0);
    expect(s.finished).toBe(false);
  });
});

describe("lỗi kho trên máy", () => {
  it("đọc hoặc ghi IndexedDB lỗi (đầy bộ nhớ…) → failed, không ném lỗi; đoạn đã ghi được giữ lại", async () => {
    const s = store();
    const full = { ...s, putPart: async (n: number, b: Uint8Array) => { if (n === 1) throw new Error("QuotaExceededError"); return s.putPart(n, b); } };
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s), ...full })).toBe("failed");
    expect([...s.parts.keys()]).toEqual([0]);
    const broken = { ...s, getPart: async () => { throw new Error("đọc lỗi"); } };
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s), ...broken })).toBe("failed");
    const noFinish = { ...s, finish: async () => { throw new Error("ghi lỗi"); } };
    expect(await downloadInChunks({ size: 25, sha256: SHA, chunkBytes: 10, fetchRange: fetchFrom(s), ...noFinish })).toBe("failed");
  });
});

describe("kiểm phản hồi Range", () => {
  const want = { start: 10, end: 19, size: 25 };
  it("chỉ nhận 206 với Content-Range khớp khoảng xin, tổng kích thước và số byte", () => {
    expect(checkRangeResponse({ status: 206, contentRange: "bytes 10-19/25", length: 10 }, want)).toBe(true);
    expect(checkRangeResponse({ status: 200, contentRange: null, length: 25 }, want)).toBe(false);
    expect(checkRangeResponse({ status: 416, contentRange: "bytes */25", length: 0 }, want)).toBe(false);
    expect(checkRangeResponse({ status: 206, contentRange: "10-19/25", length: 10 }, want)).toBe(false);
    expect(checkRangeResponse({ status: 206, contentRange: "bytes 10-18/25", length: 10 }, want)).toBe(false);
    expect(checkRangeResponse({ status: 206, contentRange: "bytes 10-19/26", length: 10 }, want)).toBe(false);
    expect(checkRangeResponse({ status: 206, contentRange: "bytes 10-19/25", length: 9 }, want)).toBe(false);
  });
});

describe("video cần dọn khỏi máy", () => {
  const m = (...ids: string[]) => ({ assets: ids.map((assetId) => ({ assetId, role: "video" })) });
  it("video bị thay hoặc khóa bị thu hồi → dọn; video còn trong manifest khác → giữ; tệp không phải video không tính", () => {
    expect(staleVideoIds(["v1", "v2", "v3"], [m("v2"), m("v3")])).toEqual(["v1"]);
    expect(staleVideoIds(["v1"], [])).toEqual(["v1"]);
    expect(staleVideoIds(["v1"], [{ assets: [{ assetId: "v1", role: "audio" }] }])).toEqual(["v1"]);
  });
});
