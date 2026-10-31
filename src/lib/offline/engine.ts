// Điều phối app học trên máy: nhận diện người dùng, đồng bộ, giấy phép, tải bài. Các quyết định nằm ở hàm thuần (sync-queue, downloads, license-state).
import { deleteOfflineDb, dbDelete, dbGet, dbGetAll, dbPut, enqueueWithSeq, openOfflineDb, type Identity } from "./db";
import { planDownloads, verifyAsset, type ManifestAsset } from "./downloads";
import type { LicenseView } from "./access";
import { licenseState } from "./license-state";
import { parsePublicKeyring, verifyLicense } from "./license-verify";
import { applySyncResults, buildEvent, nextBatch, type EventResult, type EventType, type QueuedEvent } from "./sync-queue";

export type { Identity } from "./db";

export type ManifestLesson = {
  position: number; lessonVersionId: string; externalId: string; title: string; contentHash: string; isFreeTrial: boolean;
  status: "in_progress" | "completed" | null; completedActivities: string[];
};
export type Manifest = { courseId: string; slug: string; titleVi: string; versionId: string; lessons: ManifestLesson[]; assets: ManifestAsset[]; totalBytes: number };
export type MyCourse = { slug: string; titleVi: string; sources: string[] };
type StoredLesson = { lessonVersionId: string; contentHash: string; content: unknown };
type StoredFile = { assetId: string; sha256: string; mime: string; bytes: ArrayBuffer };

const IDENTITY_KEY = "me-identity";
// Khóa công khai kiểm giấy phép được nhúng vào bản app lúc build; đổi khóa đi qua bản app mới (TD §6).
const TRUSTED_KEYS = parsePublicKeyring(process.env.NEXT_PUBLIC_LICENSE_PUBLIC_KEYS);

function csrfToken(): string {
  return document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner="))?.split("=")[1] ?? "";
}

async function postJson(path: string, body: unknown, method = "POST"): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify(body),
  });
}

function savedIdentity(): Identity | null {
  try {
    return JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "null") as Identity | null;
  } catch {
    return null;
  }
}

export type IdentityResult = { identity: Identity | null; online: boolean };

/**
 * Có mạng: hỏi máy chủ (đổi người hoặc đổi máy thì xóa dữ liệu bảo vệ của người trước). Mất mạng: dùng người đã lưu.
 * Máy chủ trả 401 nghĩa là phiên không còn hiệu lực: phải đăng nhập lại.
 */
/** Xóa dữ liệu học được bảo vệ của người này trên máy và quên người đó. */
export async function clearLocal(identity: Identity | null): Promise<void> {
  localStorage.removeItem(IDENTITY_KEY);
  if (identity) await deleteOfflineDb(identity);
}

export async function loadIdentity(): Promise<IdentityResult> {
  const saved = savedIdentity();
  let res: Response;
  try {
    res = await fetch("/api/me/session");
  } catch {
    return { identity: saved, online: false };
  }
  if (res.status === 401) {
    // Phiên hết hoặc thiết bị đã bị gỡ: không giữ bài trả phí của người đó trên máy.
    await clearLocal(saved);
    return { identity: null, online: true };
  }
  if (!res.ok) return { identity: saved, online: false };
  const identity = (await res.json()) as Identity;
  if (saved && (saved.userId !== identity.userId || saved.deviceId !== identity.deviceId)) await deleteOfflineDb(saved);
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  return { identity, online: true };
}

/** Đăng xuất. switchAccount: thu hồi cả thiết bị. Luôn xóa dữ liệu bảo vệ trên máy. */
export async function signOut(identity: Identity, opts: { switchAccount?: boolean } = {}): Promise<void> {
  try {
    // Gửi nốt tiến độ chưa đồng bộ trước khi xóa dữ liệu trên máy.
    await syncNow(identity);
    await postJson("/api/auth/learner/logout", opts.switchAccount ? { switchAccount: true } : {});
  } finally {
    await clearLocal(identity);
  }
}

// ===== Giấy phép =====

/** Trình duyệt chưa có Ed25519 trong WebCrypto thì không kiểm được chữ ký: khi mất mạng chỉ mở bài học thử. */
async function supportsEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

export type LicenseStatus = LicenseView;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function licenseStatus(identity: Identity): Promise<LicenseStatus> {
  const db = await openOfflineDb(identity);
  const token = await dbGet<string>(db, "kv", "license");
  const storedMax = (await dbGet<number>(db, "kv", "maxSeen")) ?? 0;
  if (!token) return { state: "none", claims: null, daysLeft: null, maxSeen: storedMax };
  if (!(await supportsEd25519())) return { state: "unverifiable", claims: null, daysLeft: null, maxSeen: storedMax };
  const claims = await verifyLicense(token, TRUSTED_KEYS);
  if (!claims || claims.sub !== identity.userId || claims.did !== identity.deviceId) {
    return { state: "none", claims: null, daysLeft: null, maxSeen: storedMax };
  }
  const result = licenseState({ exp: claims.exp, grace: claims.grace, deviceNow: nowSeconds(), maxSeen: storedMax });
  await dbPut(db, "kv", "maxSeen", result.maxSeen);
  return { state: result.state, claims, daysLeft: Math.ceil((claims.exp - result.maxSeen) / 86_400), maxSeen: result.maxSeen };
}

// ===== Đồng bộ =====

export async function recordEvent(identity: Identity, type: EventType, lessonVersionId: string, payload: Record<string, unknown> = {}): Promise<void> {
  const db = await openOfflineDb(identity);
  await enqueueWithSeq<QueuedEvent>(db, (lastSeq) => buildEvent({ lastSeq, type, lessonVersionId, payload }));
}

export const pendingCount = async (identity: Identity): Promise<number> =>
  (await dbGetAll<QueuedEvent>(await openOfflineDb(identity), "queue")).length;

export type SyncOutcome = { ok: true; revokedCourseIds: string[]; remaining: number } | { ok: false; reason: "offline" | "unauthorized" | "server" };

/** Gửi hàng chờ, nhận giấy phép mới. Lỗi cả request thì giữ nguyên hàng chờ. Khóa bị thu hồi thì xóa dữ liệu của khóa đó. */
export async function syncNow(identity: Identity): Promise<SyncOutcome> {
  const db = await openOfflineDb(identity);
  const queue = await dbGetAll<QueuedEvent>(db, "queue");
  const knownCourseIds = (await dbGet<string[]>(db, "kv", "knownCourseIds")) ?? [];
  let res: Response;
  try {
    res = await postJson("/api/learn/sync", {
      events: nextBatch(queue),
      knownCourseIds,
      // Máy chủ chỉ ký bằng khóa mà bản app này tin.
      trustedKids: TRUSTED_KEYS.map((k) => k.kid),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (res.status === 401) {
    await clearLocal(identity);
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok) return { ok: false, reason: "server" };
  const body = (await res.json()) as { results: EventResult[]; license: string; courses: { id: string; slug: string }[]; revokedCourseIds: string[] };

  const { keep, quarantine } = applySyncResults(queue, body.results);
  const kept = new Set(keep.map((e) => e.eventId));
  for (const e of queue) if (!kept.has(e.eventId)) await dbDelete(db, "queue", e.eventId);
  for (const q of quarantine) await dbPut(db, "quarantine", q.event.eventId, q);

  await dbPut(db, "kv", "license", body.license);
  await dbPut(db, "kv", "knownCourseIds", body.courses.map((c) => c.id));
  for (const courseId of body.revokedCourseIds) await removeCourseData(db, courseId);
  return { ok: true, revokedCourseIds: body.revokedCourseIds, remaining: keep.length };
}

async function removeCourseData(db: IDBDatabase, courseId: string): Promise<void> {
  const manifests = (await dbGet<Record<string, Manifest>>(db, "kv", "manifests")) ?? {};
  const removed = Object.values(manifests).filter((m) => m.courseId === courseId);
  const remaining = Object.values(manifests).filter((m) => m.courseId !== courseId);
  const stillUsedLessons = new Set(remaining.flatMap((m) => m.lessons.map((l) => l.lessonVersionId)));
  const stillUsedAssets = new Set(remaining.flatMap((m) => m.assets.map((a) => a.assetId)));
  for (const m of removed) {
    for (const l of m.lessons) if (!stillUsedLessons.has(l.lessonVersionId)) await dbDelete(db, "lessons", l.lessonVersionId);
    for (const a of m.assets) if (!stillUsedAssets.has(a.assetId)) await dbDelete(db, "files", a.assetId);
    delete manifests[m.slug];
  }
  await dbPut(db, "kv", "manifests", manifests);
}

// ===== Khóa và bài =====

/** Khóa của tôi: có mạng thì hỏi máy chủ và lưu lại, mất mạng dùng bản đã lưu. */
export async function loadMyCourses(identity: Identity): Promise<MyCourse[]> {
  const db = await openOfflineDb(identity);
  try {
    const res = await fetch("/api/me/courses");
    if (res.ok) {
      const { courses } = (await res.json()) as { courses: MyCourse[] };
      await dbPut(db, "kv", "myCourses", courses);
      return courses;
    }
  } catch {
    // Mất mạng.
  }
  return (await dbGet<MyCourse[]>(db, "kv", "myCourses")) ?? [];
}

export async function loadManifest(identity: Identity, slug: string): Promise<Manifest | null> {
  const db = await openOfflineDb(identity);
  const manifests = (await dbGet<Record<string, Manifest>>(db, "kv", "manifests")) ?? {};
  try {
    const res = await fetch(`/api/learn/courses/${encodeURIComponent(slug)}/manifest`);
    if (res.ok) {
      const manifest = (await res.json()) as Manifest;
      manifests[slug] = manifest;
      await dbPut(db, "kv", "manifests", manifests);
      return manifest;
    }
    if (res.status === 403 || res.status === 404) {
      if (manifests[slug]) await removeCourseData(db, manifests[slug].courseId);
      return null;
    }
  } catch {
    // Mất mạng.
  }
  return manifests[slug] ?? null;
}

export type DownloadState = { complete: boolean; missingLessons: number; missingAssets: number; assetBytes: number };

async function downloadPlan(db: IDBDatabase, manifest: Manifest) {
  const lessons = await dbGetAll<StoredLesson>(db, "lessons");
  const files = await dbGetAll<StoredFile>(db, "files");
  return planDownloads(manifest, {
    lessons: lessons.map((l) => ({ lessonVersionId: l.lessonVersionId, contentHash: l.contentHash })),
    assets: files.map((f) => ({ assetId: f.assetId, sha256: f.sha256 })),
  });
}

export async function downloadState(identity: Identity, manifest: Manifest): Promise<DownloadState> {
  const plan = await downloadPlan(await openOfflineDb(identity), manifest);
  return { complete: plan.complete, missingLessons: plan.lessons.length, missingAssets: plan.assets.length, assetBytes: plan.assetBytes };
}

/** Tải phần còn thiếu, kiểm sha256 từng tệp; đứt mạng giữa chừng thì lần sau tải tiếp từ phần còn thiếu. */
export async function downloadCourse(
  identity: Identity,
  manifest: Manifest,
  onProgress: (done: number, total: number) => void,
): Promise<"done" | "failed" | "hash_mismatch"> {
  const db = await openOfflineDb(identity);
  await navigator.storage?.persist?.().catch(() => false);
  const plan = await downloadPlan(db, manifest);
  const total = plan.lessons.length + plan.assets.length;
  let done = 0;
  onProgress(done, total);
  try {
    for (const lesson of plan.lessons) {
      const res = await fetch(`/api/learn/lessons/${lesson.lessonVersionId}`);
      if (!res.ok) return "failed";
      const { content, contentHash } = (await res.json()) as { content: unknown; contentHash: string };
      await dbPut(db, "lessons", lesson.lessonVersionId, { lessonVersionId: lesson.lessonVersionId, contentHash, content } satisfies StoredLesson);
      onProgress(++done, total);
    }
    for (const asset of plan.assets) {
      const res = await fetch(asset.url);
      if (!res.ok) return "failed";
      const bytes = await res.arrayBuffer();
      if ((await verifyAsset(bytes, asset.sha256)) !== "ok") return "hash_mismatch";
      await dbPut(db, "files", asset.assetId, { assetId: asset.assetId, sha256: asset.sha256, mime: asset.mime, bytes } satisfies StoredFile);
      onProgress(++done, total);
    }
  } catch {
    return "failed";
  }
  return "done";
}

/** Nội dung bài: bản đã tải trên máy trước, không có thì hỏi máy chủ. */
export async function loadLesson(identity: Identity, lesson: ManifestLesson): Promise<unknown | null> {
  const db = await openOfflineDb(identity);
  const stored = await dbGet<StoredLesson>(db, "lessons", lesson.lessonVersionId);
  if (stored) return stored.content;
  try {
    const res = await fetch(`/api/learn/lessons/${lesson.lessonVersionId}`);
    return res.ok ? ((await res.json()) as { content: unknown }).content : null;
  } catch {
    return null;
  }
}

/** Đường dẫn phát tệp: tệp đã tải thì tạo URL từ dữ liệu trên máy, chưa tải thì tải trực tiếp từ máy chủ. */
export async function assetUrl(identity: Identity, asset: ManifestAsset): Promise<string> {
  const stored = await dbGet<StoredFile>(await openOfflineDb(identity), "files", asset.assetId);
  return stored ? URL.createObjectURL(new Blob([stored.bytes], { type: stored.mime })) : asset.url;
}
