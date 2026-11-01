import type { Tx } from "@/lib/db";
import { claimVerifiedPhone } from "./password";

export type IdentityKind = "email" | "phone" | "google";

export async function findUserIdByIdentity(tx: Tx, kind: IdentityKind, value: string): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT user_id FROM user_identities WHERE kind = ${kind} AND value_canonical = ${value}`;
  return row?.user_id ?? null;
}

/** Tạo học viên mới cùng định danh đã xác minh. */
export async function createUserWithIdentity(
  tx: Tx,
  input: { kind: IdentityKind; value: string; displayName: string; rank: string | null },
): Promise<string> {
  const [user] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO users (display_name, rank) VALUES (${input.displayName}, ${input.rank}) RETURNING id`;
  await tx.$executeRaw`
    INSERT INTO user_identities (user_id, kind, value_canonical, verified_at)
    VALUES (${user!.id}::uuid, ${input.kind}, ${input.value}, now())`;
  // Số đã xác minh thắng dòng mật khẩu chưa xác minh của người khác (D2).
  if (input.kind === "phone") await claimVerifiedPhone(tx, user!.id, input.value);
  return user!.id;
}
