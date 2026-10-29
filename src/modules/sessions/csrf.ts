import { hmacHex, safeEqualHex } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { Realm } from "./sessions";

function csrfKey(realm: Realm): Buffer {
  const e = env();
  return Buffer.from(realm === "admin" ? e.CSRF_KEY_ADMIN : e.CSRF_KEY_LEARNER, "base64");
}

export function csrfFor(realm: Realm, sessionId: string): string {
  return hmacHex(csrfKey(realm), sessionId);
}

export function checkCsrf(realm: Realm, sessionId: string, header: string | null): boolean {
  return header !== null && safeEqualHex(header, csrfFor(realm, sessionId));
}
