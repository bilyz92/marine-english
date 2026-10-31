// Tải khóa về máy: tính phần còn thiếu theo manifest và kiểm sha256 từng tệp. Chỉ “đã tải xong” khi không còn gì thiếu.

export type ManifestAsset = {
  assetId: string; lessonVersionId: string; role: string; mime: string; bytes: number; sha256: string;
  visibility: "public" | "protected"; url: string;
};
export type ManifestLessonRef = { lessonVersionId: string; contentHash: string };

export function planDownloads<L extends ManifestLessonRef>(
  manifest: { lessons: L[]; assets: ManifestAsset[] },
  have: { lessons: ManifestLessonRef[]; assets: { assetId: string; sha256: string }[] },
): { lessons: L[]; assets: ManifestAsset[]; assetBytes: number; complete: boolean } {
  const lessonHash = new Map(have.lessons.map((l) => [l.lessonVersionId, l.contentHash]));
  const assetHash = new Map(have.assets.map((a) => [a.assetId, a.sha256]));
  const lessons = manifest.lessons.filter((l) => lessonHash.get(l.lessonVersionId) !== l.contentHash);
  // Một tệp dùng ở nhiều bài chỉ tải một lần.
  const unique = new Map(manifest.assets.map((a) => [a.assetId, a]));
  const assets = [...unique.values()].filter((a) => assetHash.get(a.assetId) !== a.sha256);
  return {
    lessons,
    assets,
    assetBytes: assets.reduce((sum, a) => sum + a.bytes, 0),
    complete: lessons.length === 0 && assets.length === 0,
  };
}

export async function verifyAsset(bytes: ArrayBuffer, sha256: string): Promise<"ok" | "hash_mismatch"> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sha256 ? "ok" : "hash_mismatch";
}
