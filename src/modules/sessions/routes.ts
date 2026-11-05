export type PathClass = "public" | "provider" | "auth" | "learner" | "admin" | "denied";

/** pathname bằng prefix hoặc nằm dưới prefix (theo ranh giới "/"). */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyPath(pathname: string): PathClass {
  if (under(pathname, "/dev")) return process.env.NODE_ENV === "development" ? "public" : "denied";
  if (pathname === "/admin/dang-nhap") return "public";
  if (pathname === "/api/payments/sepay/webhook" || pathname === "/api/telegram/webhook") return "provider";
  if (under(pathname, "/api/auth/learner") || under(pathname, "/api/auth/admin")) return "auth";
  // /mua công khai: khách chưa có tài khoản mua được (tạo tài khoản ngay trên trang, 2026-11-05).
  if (["/hoc", "/tai-khoan", "/thanh-toan", "/api/learn", "/api/me"].some((p) => under(pathname, p))) return "learner";
  if (under(pathname, "/admin") || under(pathname, "/api/quan-tri")) return "admin";
  if (under(pathname, "/api/public") || under(pathname, "/api/health")) return "public";
  if (under(pathname, "/api")) return "denied";
  return "public";
}
