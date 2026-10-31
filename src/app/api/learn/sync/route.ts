import { z } from "zod";
import { addResponseCookies, HttpError, json, parseBody, route } from "@/lib/http";
import { syncEvents } from "@/modules/learn/sync";
import { sessionCookies } from "@/modules/sessions/cookies";
import { requireLearner } from "@/modules/sessions/guards";
import { rotateIfDue } from "@/modules/sessions/sessions";

const MAX_BODY_BYTES = 262_144;
// Từng sự kiện được kiểm riêng trong syncEvents (sai thì rejected, không hủy cả lô).
const Body = z.object({
  events: z.array(z.unknown()),
  trustedKids: z.array(z.string().max(50)).max(20).optional(),
  knownCourseIds: z.array(z.uuid()).max(100).optional(),
});

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "Lô đồng bộ quá lớn");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError(413, "Lô đồng bộ quá lớn");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Dữ liệu gửi lên không hợp lệ");
  }
  const result = await syncEvents(ctx, parseBody(raw, Body));
  // Đồng bộ thành công là lúc xoay token phiên đã đủ tuổi (TD §5.2).
  const rotated = await rotateIfDue(ctx.sessionId);
  if (rotated) addResponseCookies(req, sessionCookies("learner", rotated.token, rotated.csrf));
  return json(result);
});
