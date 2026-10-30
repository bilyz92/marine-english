import { adminSession, insertAdmin } from "./admin";

export type AdminSess = { adminId: string; token: string; csrf: string };

export async function adminSess(role: "owner" | "support"): Promise<AdminSess> {
  const adminId = await insertAdmin(`${role}-${Math.random()}@x.vn`, role);
  return { adminId, ...(await adminSession(adminId)) };
}

type Handler = (req: Request, ...rest: never[]) => Promise<Response>;

/** Gọi handler quản trị trực tiếp với cookie, Origin, CSRF; `params` cho route động. */
export function callAdmin(handler: Handler, s: AdminSess, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const req = new Request(`${process.env.APP_ORIGIN}${path}`, {
    method,
    headers: { cookie: `__Host-me_admin=${s.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": s.csrf, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (handler as (r: Request, ...rest: unknown[]) => Promise<Response>)(req, ...(params ? [{ params: Promise.resolve(params) }] : []));
}
