import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addResponseCookies, clientIp, HttpError, readCookie } from "@/lib/http";
import { sessionCookieName, sessionCookies } from "./cookies";
import { checkCsrf } from "./csrf";
import { validateSession, type Realm, type SessionView } from "./sessions";

export type LearnerCtx = { userId: string; deviceId: string; sessionId: string; authAt: Date; ip: string };
export type AdminCtx = { adminId: string; role: string; sessionId: string; authAt: Date; ip: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Chỉ đọc cookie của đúng khu vực; header phân loại từ proxy không dùng để cấp quyền.
async function requireSession(req: Request, realm: Realm): Promise<SessionView> {
  const token = readCookie(req, sessionCookieName(realm));
  const view = token ? await validateSession(realm, token) : null;
  if (!view) throw new HttpError(401, "Cần đăng nhập");
  if (!SAFE_METHODS.has(req.method)) {
    if (req.headers.get("origin") !== env().APP_ORIGIN) throw new HttpError(403, "Nguồn yêu cầu không hợp lệ");
    if (!checkCsrf(realm, view.sessionId, req.headers.get("x-csrf-token"))) throw new HttpError(403, "Thiếu mã CSRF");
  }
  if (view.reissue) addResponseCookies(req, sessionCookies(realm, view.reissue.token, view.reissue.csrf));
  return view;
}

export async function requireLearner(req: Request): Promise<LearnerCtx> {
  const view = await requireSession(req, "learner");
  return { userId: view.subjectId, deviceId: view.deviceId!, sessionId: view.sessionId, authAt: view.authAt, ip: clientIp(req) };
}

export async function requireAdmin(req: Request): Promise<AdminCtx> {
  const view = await requireSession(req, "admin");
  const admin = await prisma().adminUser.findUniqueOrThrow({ where: { id: view.subjectId }, select: { role: true } });
  return { adminId: view.subjectId, role: admin.role, sessionId: view.sessionId, authAt: view.authAt, ip: clientIp(req) };
}
