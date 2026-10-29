import type { Realm } from "./sessions";

const SESSION_COOKIE: Record<Realm, string> = { learner: "__Host-me_learn", admin: "__Host-me_admin" };
const CSRF_COOKIE: Record<Realm, string> = { learner: "__Host-me_csrf_learner", admin: "__Host-me_csrf_admin" };
// Bằng hạn tuyệt đối của phiên: học viên 90 ngày, quản trị 12 giờ.
const MAX_AGE_SECONDS: Record<Realm, number> = { learner: 90 * 86_400, admin: 12 * 3_600 };

export function sessionCookieName(realm: Realm): string {
  return SESSION_COOKIE[realm];
}

function cookie(name: string, value: string, maxAge: number, httpOnly: boolean): string {
  return `${name}=${value}; Path=/; Secure;${httpOnly ? " HttpOnly;" : ""} SameSite=Lax; Max-Age=${maxAge}`;
}

/** Cookie phiên (HttpOnly) và cookie CSRF (client đọc để gửi header). */
export function sessionCookies(realm: Realm, token: string, csrf: string): string[] {
  const maxAge = MAX_AGE_SECONDS[realm];
  return [cookie(SESSION_COOKIE[realm], token, maxAge, true), cookie(CSRF_COOKIE[realm], csrf, maxAge, false)];
}

export function clearSessionCookies(realm: Realm): string[] {
  return [cookie(SESSION_COOKIE[realm], "", 0, true), cookie(CSRF_COOKIE[realm], "", 0, false)];
}
