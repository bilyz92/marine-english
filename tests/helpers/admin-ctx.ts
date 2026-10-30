import type { AdminCtx } from "@/modules/sessions/guards";
import { insertAdmin } from "./admin";

export async function adminCtx(role: "owner" | "support", authAt = new Date()): Promise<AdminCtx> {
  const adminId = await insertAdmin(`${role}-${Math.random()}@x.vn`, role);
  return { adminId, role, sessionId: crypto.randomUUID(), authAt, ip: "10.0.0.1" };
}

export async function rejected(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (error) {
    const e = error as { status?: number; message?: string };
    if (e.status === 403) return e.message ?? "403";
    throw error;
  }
}
