import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/modules/sessions/routes";
import { sessionCookieName } from "@/modules/sessions/cookies";

// Lớp chặn sớm. Quyền thật luôn được kiểm lại trong từng handler (requireLearner/requireAdmin).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // Trang quản trị chuyển từ /quan-tri sang /admin (02/11/2026); link cũ vẫn dùng được. Trình duyệt giữ #link= khi chuyển hướng.
  if (pathname === "/quan-tri" || pathname.startsWith("/quan-tri/")) {
    const to = request.nextUrl.clone();
    to.pathname = `/admin${pathname.slice("/quan-tri".length)}`;
    return NextResponse.redirect(to, 308);
  }
  const kind = classifyPath(pathname);
  if (kind === "denied") return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  if ((kind === "learner" || kind === "admin") && !request.cookies.has(sessionCookieName(kind))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
    const login = kind === "admin" ? "/admin/dang-nhap" : "/dang-nhap";
    return NextResponse.redirect(new URL(`${login}?next=${encodeURIComponent(pathname)}`, request.url));
  }

  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith("x-me-")) headers.delete(name);
  headers.set("x-me-realm", kind);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Tải gói nội dung không qua proxy (proxy đệm thân request, giới hạn 10 MB); handler tự kiểm phiên, CSRF, quyền và kích thước.
  matcher: ["/((?!_next/|favicon.ico|api/quan-tri/content/import$).*)"],
};
