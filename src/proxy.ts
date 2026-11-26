import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/modules/sessions/routes";
import { sessionCookieName } from "@/modules/sessions/cookies";
import { routePublicPath } from "@/modules/content/public-urls";
import { getArticle } from "@/modules/articles/articles";

/** Không có route nào ở đây: Next dựng trang không tìm thấy (src/app/not-found.tsx) với mã 404 thật. */
const NOT_FOUND_PATH = "/_khong-tim-thay";

// Lớp chặn sớm. Quyền thật luôn được kiểm lại trong từng handler (requireLearner/requireAdmin).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // Trang quản trị chuyển từ /quan-tri sang /admin (02/11/2026); link cũ vẫn dùng được. Trình duyệt giữ #link= khi chuyển hướng.
  if (pathname === "/quan-tri" || pathname.startsWith("/quan-tri/")) {
    const to = request.nextUrl.clone();
    to.pathname = `/admin${pathname.slice("/quan-tri".length)}`;
    return NextResponse.redirect(to, 308);
  }
  // Trang khóa, bài học thử, danh mục: trang dựng theo luồng gửi mã 200 trước khi biết khóa có hay không (Cache Components), nên
  // 404 thật và chuyển hướng vĩnh viễn (mã nội bộ, đường dẫn cũ, ?dm=<id>) quyết ở đây, trước khi trang chạy.
  if (pathname === "/khoa-hoc" || pathname.startsWith("/khoa-hoc/")) {
    const decision = await routePublicPath(pathname, request.nextUrl.search);
    if (decision?.kind === "redirect") return NextResponse.redirect(new URL(decision.to, request.url), 308);
    if (decision?.kind === "not_found") return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }
  // Bài viết: trang dựng sẵn cho các bài có trong content/bai-viet; đường dẫn khác cũng phải là 404 thật.
  const article = /^\/bai-viet\/([^/]+)$/.exec(pathname);
  if (article && !getArticle(article[1]!)) return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
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
  // Tải gói nội dung và tải video của một bài không qua proxy (proxy đệm thân request, giới hạn 10 MB); handler tự kiểm phiên,
  // CSRF, quyền và kích thước.
  matcher: ["/((?!_next/|favicon.ico|api/quan-tri/content/import$|api/quan-tri/content/courses/[^/]+/lessons/[^/]+/video$).*)"],
};
