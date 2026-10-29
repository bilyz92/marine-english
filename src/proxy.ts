import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/modules/sessions/routes";
import { sessionCookieName } from "@/modules/sessions/cookies";

// Lớp chặn sớm. Quyền thật luôn được kiểm lại trong từng handler (requireLearner/requireAdmin).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const kind = classifyPath(pathname);
  if (kind === "denied") return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  if ((kind === "learner" || kind === "admin") && !request.cookies.has(sessionCookieName(kind))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
    const login = kind === "admin" ? "/quan-tri/dang-nhap" : "/dang-nhap";
    return NextResponse.redirect(new URL(`${login}?next=${encodeURIComponent(pathname)}`, request.url));
  }

  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith("x-me-")) headers.delete(name);
  headers.set("x-me-realm", kind);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
