import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { adminRemoveDevice, listUserDevices } from "@/modules/learn/devices";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!z.uuid().safeParse(userId).success) throw new HttpError(400, "Thiếu mã học viên");
  return json({ devices: await listUserDevices(ctx, userId) });
});

const Body = z.object({ deviceId: z.uuid(), reason: z.string().trim().min(1).max(1000) });

export const DELETE = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const { deviceId, reason } = await readJson(req, Body);
  const result = await adminRemoveDevice(ctx, deviceId, reason);
  return json({ result }, { status: result === "removed" ? 200 : 404 });
});
