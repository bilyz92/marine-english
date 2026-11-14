import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbGet, openOfflineDb } from "@/lib/offline/db";
import { loadManifest, type Manifest } from "@/lib/offline/engine";

// Codex 15/11/2026: tải manifest và thu hồi khóa cùng lúc không được ghi đè nhau bằng bản đọc cũ.
const who = () => ({ userId: `u${Math.random()}`, deviceId: "d1" });
const manifest = (slug: string, courseId = `c-${slug}`): Manifest => ({
  courseId, slug, titleVi: slug, versionId: `v-${slug}`, lessons: [], assets: [], totalBytes: 0,
});
type Pending = { slug: string; resolve: (r: Response) => void };

function deferredFetch() {
  const pending: Pending[] = [];
  vi.stubGlobal("fetch", (url: string) => new Promise<Response>((resolve) => {
    pending.push({ slug: decodeURIComponent(String(url).split("/")[4]!), resolve });
  }));
  // Trả lời một yêu cầu đang chờ của khóa đó: mặc định yêu cầu gửi sớm nhất, `last` = yêu cầu gửi muộn nhất.
  const answer = async (slug: string, res: Response, which: "first" | "last" = "first") => {
    for (let i = 0; i < 50 && !pending.some((p) => p.slug === slug); i++) await new Promise((r) => setTimeout(r, 5));
    const mine = pending.filter((p) => p.slug === slug);
    const p = which === "first" ? mine[0]! : mine[mine.length - 1]!;
    pending.splice(pending.indexOf(p), 1);
    p.resolve(res);
  };
  return { answer };
}
const ok = (m: Manifest) => new Response(JSON.stringify(m), { status: 200 });
const stored = async (w: { userId: string; deviceId: string }) => Object.keys((await dbGet<Record<string, Manifest>>(await openOfflineDb(w), "kv", "manifests")) ?? {}).sort();

afterEach(() => vi.unstubAllGlobals());

describe("lưu manifest trên máy", () => {
  it("hai khóa tải manifest cùng lúc → cả hai đều được lưu", async () => {
    const w = who();
    const f = deferredFetch();
    const a = loadManifest(w, "a");
    const b = loadManifest(w, "b");
    await f.answer("a", ok(manifest("a")));
    await f.answer("b", ok(manifest("b")));
    await Promise.all([a, b]);
    expect(await stored(w)).toEqual(["a", "b"]);
  });

  it("khóa bị thu hồi trong lúc manifest khác đang tải → không khôi phục khóa đã thu hồi", async () => {
    const w = who();
    let f = deferredFetch();
    const first = loadManifest(w, "x");
    await f.answer("x", ok(manifest("x")));
    await first;
    expect(await stored(w)).toEqual(["x"]);
    f = deferredFetch();
    const again = loadManifest(w, "x");
    const revoke = loadManifest(w, "x");
    await new Promise((r) => setTimeout(r, 30));
    await f.answer("x", new Response("", { status: 403 }), "last");
    await revoke;
    await f.answer("x", ok(manifest("x")));
    await again;
    expect(await stored(w)).toEqual([]);
  });
});
