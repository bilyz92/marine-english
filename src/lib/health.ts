export function createHealthHandler(ping: () => Promise<void>) {
  // Đọc request để Next không prerender route này lúc build (Cache Components).
  return async function health(request: Request): Promise<Response> {
    void request.headers;
    try {
      await ping();
      return Response.json({ ok: true, db: "up" });
    } catch {
      return Response.json({ ok: false }, { status: 503 });
    }
  };
}
