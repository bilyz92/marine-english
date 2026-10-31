// Xác minh giấy phép bằng WebCrypto: dùng được cả trong trình duyệt (học offline) lẫn Node.

export type LicenseClaims = {
  v: number;
  sub: string;
  did: string;
  courses: { id: string; versionId: string }[];
  iat: number;
  exp: number;
  grace: number;
};

export type LicensePublicKey = { kid: string; x: string };

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const decodeJson = (part: string): unknown => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Chỉ nhận claims đúng cấu trúc phiên bản 1; chữ ký đúng mà nội dung lạ vẫn bị từ chối. */
function asClaims(value: unknown): LicenseClaims | null {
  const c = value as Record<string, unknown> | null;
  if (!c || c.v !== 1 || !isString(c.sub) || !isString(c.did) || !isTime(c.iat) || !isTime(c.exp) || !isTime(c.grace)) return null;
  if (!Array.isArray(c.courses) || !c.courses.every((x) => isString((x as { id?: unknown })?.id) && isString((x as { versionId?: unknown })?.versionId))) return null;
  return c as unknown as LicenseClaims;
}

/** Khóa công khai nhúng vào bản app lúc build ("kid:x,kid:x"): đổi khóa đi qua bản app mới, không lấy từ dữ liệu trên máy. */
export function parsePublicKeyring(value: string | undefined): LicensePublicKey[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ kid: part.slice(0, part.indexOf(":")), x: part.slice(part.indexOf(":") + 1) }))
    .filter((k) => k.kid && k.x);
}

/** Trả claims khi chữ ký đúng với khóa công khai theo kid; mọi sai lệch (định dạng, alg, kid lạ, chữ ký) → null. */
export async function verifyLicense(token: string, keys: LicensePublicKey[]): Promise<LicenseClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson(parts[0]!) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "EdDSA") return null;
    const key = keys.find((k) => k.kid === header.kid);
    if (!key) return null;
    const publicKey = await crypto.subtle.importKey("raw", fromBase64Url(key.x), { name: "Ed25519" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, fromBase64Url(parts[2]!), signed);
    return ok ? asClaims(decodeJson(parts[1]!)) : null;
  } catch {
    return null;
  }
}
