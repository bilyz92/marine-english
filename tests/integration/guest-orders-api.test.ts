import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createRoute } from "@/app/api/public/orders/route";
import { GET as getRoute } from "@/app/api/public/orders/[code]/route";
import { ingest } from "@/modules/ledger/ingest";
import { readPendingCredentials } from "@/modules/auth-learner/pending-credentials";
import { classifyPath } from "@/modules/sessions/routes";
import { publish, seedContent } from "../helpers/content";
import { cookieValue, ORIGIN } from "../helpers/learner";
import { PRICE, report, SLUG } from "../helpers/ledger";
import { sqlAsMigrator } from "../helpers/otp";

// API công khai cho đơn khách (docs/superpowers/plans/2026-11-16-guest-orders.md, Task 4).

const mail = vi.hoisted(() => ({ ready: true }));
vi.mock("@/modules/mail/email-sender", async (original) => ({
  ...(await original<typeof import("@/modules/mail/email-sender")>()),
  emailReady: () => mail.ready,
}));
vi.mock("@/modules/orders/payment-info", async (original) => {
  const actual = await original<typeof import("@/modules/orders/payment-info")>();
  return {
    ...actual,
    paymentInfo: () => ({ bankName: "VCB", accountNo: "0123456789", accountName: "NGUYEN VAN A", qrImageUrl: null, bankBin: "970436", termsVersion: "v1" }),
  };
});

let ipSeq = 0;
const freshIp = () => `10.12.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const COOKIE = (code: string) => `__Host-me_order_${code}`;

async function create(patch: Record<string, unknown> = {}, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": freshIp() };
  if (origin) headers.origin = origin;
  const res = await createRoute(new Request(`${ORIGIN}/api/public/orders`, {
    method: "POST", headers,
    body: JSON.stringify({ courseSlug: SLUG, displayName: "Khách", phone: "0912000111", email: "nguyen@gmail.com", emailConfirm: "nguyen@gmail.com", acceptTerms: true, ...patch }),
  }));
  const body = (await res.json()) as { code?: string; error?: string };
  return { status: res.status, body, cache: res.headers.get("cache-control") ?? "", token: body.code ? cookieValue(res, COOKIE(body.code)) : undefined };
}
async function view(code: string, token?: string) {
  const res = await getRoute(new Request(`${ORIGIN}/api/public/orders/${code}`, { headers: token ? { cookie: `${COOKIE(code)}=${token}` } : {} }),
    { params: Promise.resolve({ code }) });
  return { status: res.status, text: await res.text() };
}

beforeEach(async () => {
  mail.ready = true;
  await seedContent();
  await publish(SLUG, PRICE);
});

describe("API đơn khách", () => {
  it("creates a guest order and sets the access cookie", async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^ME[A-Z0-9]{8}$/);
    expect(r.token).toBeTruthy();
    expect(r.cache).toContain("no-store");
    const v = await view(r.body.code!, r.token);
    expect(v.status).toBe(200);
    expect(JSON.parse(v.text)).toMatchObject({ code: r.body.code, status: "pending", amountDueVnd: PRICE, claimable: false, guest: { emailMasked: "n•••@gmail.com", emailStatus: null } });
  });

  it("email_mismatch, taken phone, cross-origin", async () => {
    expect((await create({ emailConfirm: "khac@gmail.com" })).body).toEqual({ error: "email_mismatch" });
    expect((await create({}, null)).status).toBe(403);
    expect((await create({}, "https://la.example")).status).toBe(403);
    const { rows: [u] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('Cũ') RETURNING id`);
    await sqlAsMigrator(`INSERT INTO password_logins (user_id, phone_canonical, password_hash) VALUES ($1, '+84912000222', 'scrypt$x')`, [u.id]);
    const taken = await create({ phone: "0912000222", email: "moi@gmail.com", emailConfirm: "moi@gmail.com" });
    expect(taken).toMatchObject({ status: 409, body: { error: "phone_taken" } });
  });

  it("guest checkout requires the access cookie", async () => {
    const a = await create();
    const b = await create({ phone: "0912000333", email: "b@gmail.com", emailConfirm: "b@gmail.com" });
    expect((await view(a.body.code!)).status).toBe(404);
    expect((await view(a.body.code!, b.token)).status).toBe(404);
    expect((await view(a.body.code!, "sai")).status).toBe(404);
  });

  it("paid guest checkout shows a masked email and no password", async () => {
    const r = await create();
    const { rows: [o] } = await sqlAsMigrator(`SELECT created_at FROM orders WHERE code = $1`, [r.body.code]);
    expect(await ingest(report({ content: r.body.code!, bankTime: new Date(new Date(o.created_at).getTime() + 60_000) }))).toBe("confirmed");
    const { rows: [paid] } = await sqlAsMigrator(`SELECT user_id FROM orders WHERE code = $1`, [r.body.code]);
    const creds = await readPendingCredentials(paid.user_id);
    const v = await view(r.body.code!, r.token);
    expect(v.status).toBe(200);
    expect(JSON.parse(v.text)).toMatchObject({ status: "paid", enrolled: true, guest: { emailMasked: "n•••@gmail.com", emailStatus: "queued" } });
    expect(v.text).not.toContain(creds!.password);
  });

  it("guest checkout is refused when email is not ready", async () => {
    mail.ready = false;
    expect(await create()).toMatchObject({ status: 503, body: { error: "email_unavailable" } });
    const { rows: [n] } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM orders`);
    expect(n.n).toBe(0);
  });

  it("the guest order page and API are public", () => {
    expect(classifyPath("/don-hang/ME7K3QX9AB")).toBe("public");
    expect(classifyPath("/api/public/orders/ME7K3QX9AB")).toBe("public");
  });
});
