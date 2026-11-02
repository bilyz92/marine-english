import { afterEach, describe, expect, it, vi } from "vitest";

// Đổi tài khoản trên cùng máy mà không đăng xuất: hồ sơ và bài làm 3 mức của người trước phải bị xóa.
vi.mock("@/lib/offline/db", () => ({
  deleteOfflineDb: vi.fn(async () => {}), advanceMaxSeen: vi.fn(), dbDelete: vi.fn(), dbGet: vi.fn(), dbGetAll: vi.fn(), dbPut: vi.fn(), enqueueWithSeq: vi.fn(), openOfflineDb: vi.fn(),
}));

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("đổi người dùng trên máy", () => {
  it("người khác đăng nhập → xóa hồ sơ của người trước; cùng người đổi thiết bị → giữ", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const { saveProfile, loadProfile } = await import("@/lib/study/storage");
    const { loadIdentity } = await import("@/lib/offline/engine");
    const respond = (body: object) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    localStorage.setItem("me-identity", JSON.stringify({ userId: "u1", deviceId: "d1", displayName: "An" }));
    saveProfile("u1", { full_name: "An" });
    respond({ userId: "u1", deviceId: "d2", displayName: "An" });
    await loadIdentity();
    expect(loadProfile("u1")).toEqual({ full_name: "An" });

    respond({ userId: "u2", deviceId: "d2", displayName: "Bình" });
    await loadIdentity();
    expect(loadProfile("u1")).toEqual({});

    // Xóa dữ liệu offline lỗi vẫn phải xóa hồ sơ của người trước.
    const db = await import("@/lib/offline/db");
    vi.mocked(db.deleteOfflineDb).mockRejectedValueOnce(new Error("bị chặn"));
    saveProfile("u2", { full_name: "Bình" });
    respond({ userId: "u3", deviceId: "d2", displayName: "Chi" });
    await loadIdentity().catch(() => {});
    expect(loadProfile("u2")).toEqual({});
  });
});
