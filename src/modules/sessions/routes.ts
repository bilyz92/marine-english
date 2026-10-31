export type PathClass = "public" | "provider" | "auth" | "learner" | "admin" | "denied";

/** pathname bằng prefix hoặc nằm dưới prefix (theo ranh giới "/"). */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyPath(pathname: string): PathClass {
  if (under(pathname, "/dev")) return process.env.NODE_ENV === "development" ? "public" : "denied";
  if (pathname === "/quan-tri/dang-nhap") return "public";
  if (pathname === "/api/payments/sepay/webhook") return "provider";
  if (under(pathname, "/api/auth/learner") || under(pathname, "/api/auth/admin")) return "auth";
  if (["/hoc", "/tai-khoan", "/mua", "/thanh-toan", "/api/learn", "/api/me"].some((p) => under(pathname, p))) return "learner";
  if (under(pathname, "/quan-tri") || under(pathname, "/api/quan-tri")) return "admin";
  if (under(pathname, "/api/public") || pathname === "/api/health") return "public";
  if (under(pathname, "/api")) return "denied";
  return "public";
}
