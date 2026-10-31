import { json, route } from "@/lib/http";
import { publicLicenseKeys } from "@/modules/learn/license";

export const GET = route(async (req: Request) => {
  // Đọc request để route chạy lúc request (khóa nằm trong biến môi trường, không có lúc build).
  void req.headers;
  return json({ keys: publicLicenseKeys() });
});
