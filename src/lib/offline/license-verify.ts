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
    return ok ? (decodeJson(parts[1]!) as LicenseClaims) : null;
  } catch {
    return null;
  }
}
