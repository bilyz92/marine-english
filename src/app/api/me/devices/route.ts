import { z } from "zod";
import { HttpError, json, route, withCookies } from "@/lib/http";
import { listMyDevices, removeMyDevice } from "@/modules/learn/devices";
import { clearSessionCookies } from "@/modules/sessions/cookies";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  return json({ devices: await listMyDevices(ctx) });
});

const STATUS = { removed: 200, reauth_required: 403, not_found: 404 } as const;

export const DELETE = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) throw new HttpError(400, "Thiếu mã thiết bị");
  const result = await removeMyDevice(ctx, id);
  const res = json({ result }, { status: STATUS[result] });
  // Gỡ chính máy đang dùng cũng là đăng xuất.
  return result === "removed" && id === ctx.deviceId ? withCookies(res, clearSessionCookies("learner")) : res;
});
