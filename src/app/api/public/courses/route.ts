import { json, route } from "@/lib/http";
import { listPublishedCatalog } from "@/modules/content/catalog";

export const GET = route(async (req: Request) => {
  // Đọc request để route luôn chạy lúc request (không prerender lúc build).
  void req.headers;
  // Danh sách phẳng (mỗi khóa có danh mục) và nhóm theo danh mục.
  return json(await listPublishedCatalog());
});
