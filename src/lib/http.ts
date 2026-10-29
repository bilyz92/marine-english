export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

// Cookie mà guard cần gửi kèm phản hồi (ví dụ cấp lại token sau khi xoay), gắn theo request.
const pendingCookies = new WeakMap<Request, string[]>();

export function addResponseCookies(req: Request, cookies: string[]): void {
  pendingCookies.set(req, [...(pendingCookies.get(req) ?? []), ...cookies]);
}

export function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

/** Bọc route handler: đổi HttpError thành JSON lỗi và đính cookie guard để lại. */
export function route<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    let res: Response;
    try {
      res = await handler(req, ...rest);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      res = json({ error: error.message }, { status: error.status });
    }
    return withCookies(res, pendingCookies.get(req) ?? []);
  };
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** IP người dùng: mục cuối của X-Forwarded-For do reverse proxy của mình thêm vào. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || "127.0.0.1";
}
