import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { now as clockNow } from "@/lib/clock";
import { env } from "@/lib/env";
import type { LicenseClaims, LicensePublicKey } from "@/lib/offline/license-verify";

// Giấy phép học offline — TD §6, đề xuất G9: JWS EdDSA, hiệu lực 30 ngày, ân hạn 7 ngày.
const VALID_SECONDS = 30 * 86_400;
const GRACE_SECONDS = 7 * 86_400;
// Khóa mở tạm (khách báo đã chuyển, chủ chưa duyệt): học offline tối đa 3 ngày, không ân hạn (chủ chọn 03/11/2026).
const PROVISIONAL_SECONDS = 3 * 86_400;
// Tiền tố PKCS#8 của khóa riêng Ed25519, theo sau là 32 byte khóa.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const privateKeyOf = (seed: Buffer): KeyObject =>
  createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Khóa ký: khóa hiện hành nếu client tin nó (hoặc không khai báo), không thì khóa đầu tiên client tin; client không tin khóa nào đang có → khóa hiện hành. */
function chooseKid(trustedKids: string[] | undefined): string {
  const { LICENSE_SIGNING_KEYS: ring, LICENSE_SIGNING_KID_CURRENT: current } = env();
  if (!trustedKids || trustedKids.includes(current)) return current;
  return [...ring.keys()].find((kid) => trustedKids.includes(kid)) ?? current;
}

export function issueLicense(input: {
  userId: string;
  deviceId: string;
  courses: { id: string; versionId: string; provisional?: boolean }[];
  now?: Date;
  trustedKids?: string[];
}): string {
  const kid = chooseKid(input.trustedKids);
  const iat = Math.floor((input.now ?? clockNow()).getTime() / 1000);
  const courses = input.courses.map((c) => ({ id: c.id, versionId: c.versionId, ...(c.provisional && { until: iat + PROVISIONAL_SECONDS }) }));
  // Có hạn riêng → phiên bản 2: app cũ (chỉ biết v1, không đọc until) từ chối giấy phép thay vì cho học quá hạn.
  // Không có khóa mở tạm thì giữ v1 để app cũ của người đã mua vẫn học bình thường.
  const claims: LicenseClaims = {
    v: courses.some((c) => c.until !== undefined) ? 2 : 1, sub: input.userId, did: input.deviceId, iat, courses, exp: iat + VALID_SECONDS, grace: GRACE_SECONDS,
  };
  const signingInput = `${part({ alg: "EdDSA", kid, typ: "JWT" })}.${part(claims)}`;
  const signature = sign(null, Buffer.from(signingInput), privateKeyOf(env().LICENSE_SIGNING_KEYS.get(kid)!));
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Khóa công khai để app xác minh giấy phép khi không có mạng. */
export function publicLicenseKeys(): LicensePublicKey[] {
  return [...env().LICENSE_SIGNING_KEYS.entries()].map(([kid, seed]) => ({
    kid,
    x: createPublicKey(privateKeyOf(seed)).export({ format: "jwk" }).x!,
  }));
}
