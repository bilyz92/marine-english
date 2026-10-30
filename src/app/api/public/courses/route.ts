import { json, route } from "@/lib/http";
import { listPublishedCourses } from "@/modules/content/catalog";

export const GET = route(async (req: Request) => {
  // Đọc request để route luôn chạy lúc request (không prerender lúc build).
  void req.headers;
  return json({ courses: await listPublishedCourses() });
});
