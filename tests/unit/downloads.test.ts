import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planDownloads, verifyAsset } from "@/lib/offline/downloads";

const manifest = {
  lessons: [
    { lessonVersionId: "l1", contentHash: "h1" },
    { lessonVersionId: "l2", contentHash: "h2" },
  ],
  assets: [
    { assetId: "a1", lessonVersionId: "l1", role: "audio", mime: "audio/mpeg", bytes: 100, sha256: "s1", visibility: "protected" as const, url: "/api/learn/files/a1" },
    { assetId: "a1", lessonVersionId: "l2", role: "audio", mime: "audio/mpeg", bytes: 100, sha256: "s1", visibility: "protected" as const, url: "/api/learn/files/a1" },
    { assetId: "a2", lessonVersionId: "l2", role: "audio", mime: "audio/mpeg", bytes: 50, sha256: "s2", visibility: "protected" as const, url: "/api/learn/files/a2" },
  ],
};

describe("kế hoạch tải", () => {
  it("chưa có gì: tải mọi bài, mỗi tệp một lần, tính đúng dung lượng", () => {
    const plan = planDownloads(manifest, { lessons: [], assets: [] });
    expect(plan.lessons.map((l) => l.lessonVersionId)).toEqual(["l1", "l2"]);
    expect(plan.assets.map((a) => a.assetId)).toEqual(["a1", "a2"]);
    expect(plan.assetBytes).toBe(150);
    expect(plan.complete).toBe(false);
  });

  it("bỏ qua cái đã có đúng hash; tải lại cái sai hash; đủ hết → complete", () => {
    const plan = planDownloads(manifest, {
      lessons: [{ lessonVersionId: "l1", contentHash: "h1" }, { lessonVersionId: "l2", contentHash: "cu" }],
      assets: [{ assetId: "a1", sha256: "s1" }, { assetId: "a2", sha256: "sai" }],
    });
    expect(plan.lessons.map((l) => l.lessonVersionId)).toEqual(["l2"]);
    expect(plan.assets.map((a) => a.assetId)).toEqual(["a2"]);
    expect(plan.assetBytes).toBe(50);
    const done = planDownloads(manifest, {
      lessons: manifest.lessons,
      assets: [{ assetId: "a1", sha256: "s1" }, { assetId: "a2", sha256: "s2" }],
    });
    expect(done).toMatchObject({ lessons: [], assets: [], assetBytes: 0, complete: true });
  });
});

describe("kiểm tệp tải về", () => {
  it("đúng sha256 → ok; sai (đứt giữa chừng, tệp hỏng) → hash_mismatch", async () => {
    const bytes = new TextEncoder().encode("âm thanh").buffer;
    const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    expect(await verifyAsset(bytes, sha)).toBe("ok");
    expect(await verifyAsset(bytes.slice(0, 3), sha)).toBe("hash_mismatch");
  });
});
