import { hmacHex, randomToken, safeEqualHex } from "@/lib/crypto";
import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { hashDeviceKey } from "@/modules/auth-learner/devices";
import type { Realm } from "@/modules/sessions/sessions";

export type OidcIntent = "login" | "link" | "admin_login";

export type OidcStateRow = {
  id: string;
  realm: Realm;
  intent: OidcIntent;
  userId: string | null;
  nonce: string;
  codeVerifier: string;
  deviceKeyHash: string | null;
  deviceLabel: string | null;
  createdAt: Date;
};

const stateKey = () => Buffer.from(env().OIDC_STATE_KEY, "base64");

/** State OIDC dùng một lần, sống 10 phút; DB lưu hash của state, cookie mang id kèm chữ ký. */
export async function createOidcState(
  tx: Tx,
  input: { realm: Realm; intent: OidcIntent; userId?: string; deviceKey?: string; deviceLabel?: string },
): Promise<{ cookieValue: string; state: string; nonce: string; codeVerifier: string }> {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  const deviceKeyHash = input.deviceKey === undefined ? null : hashDeviceKey(input.deviceKey);
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO oidc_states (state_hash, realm, intent, user_id, nonce, code_verifier, device_key_hash, device_label, expires_at)
    VALUES (${hmacHex(stateKey(), state)}, ${input.realm}, ${input.intent}, ${input.userId ?? null}::uuid, ${nonce},
            ${codeVerifier}, ${deviceKeyHash}, ${input.deviceLabel ?? null}, now() + interval '10 minutes')
    RETURNING id`;
  const id = row!.id;
  return { cookieValue: `${id}.${hmacHex(stateKey(), id)}`, state, nonce, codeVerifier };
}

/** Tiêu thụ state (một lần) nếu cookie hợp lệ, state khớp, đúng khu vực và còn hạn. */
export async function consumeOidcState(tx: Tx, realm: Realm, cookieValue: string, stateParam: string): Promise<OidcStateRow | null> {
  const [id, signature] = cookieValue.split(".");
  if (!id || !signature || !safeEqualHex(signature, hmacHex(stateKey(), id)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await tx.$queryRaw<
    {
      id: string; realm: Realm; intent: OidcIntent; user_id: string | null; nonce: string; code_verifier: string;
      device_key_hash: string | null; device_label: string | null; created_at: Date;
    }[]
  >`
    UPDATE oidc_states SET used_at = now()
    WHERE id = ${id}::uuid AND state_hash = ${hmacHex(stateKey(), stateParam)} AND realm = ${realm}
      AND used_at IS NULL AND expires_at > now()
    RETURNING id, realm, intent, user_id, nonce, code_verifier, device_key_hash, device_label, created_at`;
  if (!row) return null;
  return {
    id: row.id, realm: row.realm, intent: row.intent, userId: row.user_id, nonce: row.nonce, codeVerifier: row.code_verifier,
    deviceKeyHash: row.device_key_hash, deviceLabel: row.device_label, createdAt: row.created_at,
  };
}
