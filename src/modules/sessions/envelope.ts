import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import type { Realm } from "./sessions";

// Phong bì next_token_enc: v1.<kid>.<nonce>.<ciphertext>.<tag>, AES-256-GCM.
// AAD gắn khu vực, phiên và hash token mới nên không chép sang phiên khác được.
type EnvelopeAad = { realm: Realm; sessionId: string; newTokenHash: string };

const aadOf = (a: EnvelopeAad) => Buffer.from(`${a.realm}|${a.sessionId}|${a.newTokenHash}`);

export function sealNextToken(input: EnvelopeAad & { token: string }): string {
  const { SESSION_ENC_KEYS, SESSION_ENC_KEY_CURRENT: kid } = env();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SESSION_ENC_KEYS.get(kid)!, nonce);
  cipher.setAAD(aadOf(input));
  const ciphertext = Buffer.concat([cipher.update(input.token, "utf8"), cipher.final()]);
  const parts = [nonce, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64url"));
  return ["v1", kid, ...parts].join(".");
}

/** Mở phong bì; sai định dạng, kid lạ, bị sửa hoặc AAD khác đều trả null. */
export function openNextToken(envelope: string, aad: EnvelopeAad): string | null {
  const [version, kid, nonceB64, ctB64, tagB64, ...rest] = envelope.split(".");
  if (version !== "v1" || !kid || nonceB64 === undefined || ctB64 === undefined || tagB64 === undefined || rest.length) {
    return null;
  }
  const key = env().SESSION_ENC_KEYS.get(kid);
  const nonce = Buffer.from(nonceB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (!key || nonce.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadOf(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
