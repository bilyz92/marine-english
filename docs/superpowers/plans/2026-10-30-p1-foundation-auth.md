# P1 — Nền tảng và đăng nhập: Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng repo Next.js chạy được với Postgres, có phiên đăng nhập tự quản lý cho học viên (email OTP, Google, tối đa 2 thiết bị, liên kết định danh) và cho quản trị (lời mời, Google/link email, bảo vệ chủ cuối cùng, ma trận quyền, nhật ký).

**Architecture:** Một ứng dụng Next.js App Router (TypeScript strict). Logic nằm trong `src/modules/*`; route chỉ kiểm đầu vào/quyền rồi gọi module. Postgres qua Prisma; ràng buộc khó (trigger, index một phần, hàm, quyền DB) viết bằng SQL trong migration. Phiên là token ngẫu nhiên trong cookie, DB lưu HMAC.

**Tech Stack (ghim chính xác):** Node 24.15, pnpm 10.13, `next@16.4.3`, `react`/`react-dom@19` (bản đi kèm `create-next-app@16.4.3`), `typescript@5.9.3`, `prisma@7.10.1` + `@prisma/client@7.10.1` + `@prisma/adapter-pg@7.10.1` + `pg@8.23.1` (Prisma 7 bắt buộc driver adapter), `zod@4.6.7`, `openid-client@6.8.8`, `vitest@5.0.5`, `oauth2-mock-server@9.3.0`, PostgreSQL 16 (Docker).

**Spec:** `docs/technical-design-draft-2026-10-30.md` (§1, §2, §3.1–3.2, §5, Phụ lục A) và `docs/design-gates-2026-10-30.md` (mở đầu, §3, §4, §5). Khi lệch, design-gates thắng. Ngoài phạm vi: mục cuối tệp.

## Global Constraints

- Thư mục chưa là git repo: Task 1 chạy `git init`. Commit cục bộ sau mỗi task; **không push, không deploy**. Trước mỗi commit chạy `/codex-impl-review` tới APPROVE.
- `timestamptz` UTC; thời điểm do DB (`now()`) sinh trong transaction. Khóa ngoại `ON DELETE RESTRICT`.
- Cookie (mọi cookie dưới đây có `Secure; Path=/; SameSite=Lax`): `__Host-me_learn`, `__Host-me_admin`, `__Host-me_ticket`, `__Host-me_oidc_learner`, `__Host-me_oidc_admin` là `HttpOnly`; `__Host-me_csrf_learner`, `__Host-me_csrf_admin` **không** `HttpOnly` (client đọc để gửi header).
- Token phiên/vé/link/state: 32 byte (`crypto.randomBytes`), base64url; DB chỉ lưu `HMAC-SHA256(key, token)` hex. Không lưu token dạng chữ rõ; ngoại lệ duy nhất là phong bì `next_token_enc` 2 phút.
- **Phong bì `next_token_enc`:** chuỗi `v1.<kid>.<nonce>.<ciphertext>.<tag>` (base64url từng phần); AES-256-GCM; nonce 12 byte ngẫu nhiên mỗi lần; tag 16 byte; AAD = `` `${realm}|${sessionId}|${newTokenHash}` ``; khóa từ `SESSION_ENC_KEYS` theo `kid`; sau khi giải mã phải `HMAC(token) === token_hash` hiện tại.
- **CSRF:** mọi POST/PUT/PATCH/DELETE có phiên phải có `Origin === APP_ORIGIN` **và** header `x-csrf-token === HMAC(CSRF_KEY_<realm>, sessionId)` (cookie `__Host-me_csrf_<realm>` mang cùng giá trị, đặt khi tạo phiên và khi xoay).
- OTP: 6 chữ số từ `crypto.randomInt(0, 1_000_000)` đệm 0; hạn 5 phút (`expires_at = created_at + interval '5 minutes'`); tối đa 5 lần sai; lưu `HMAC(pepper[key_version], purpose|kind|value|code)`. Giới hạn tính theo **định danh (kind, value), mọi purpose cộng chung**: khoảng chờ 60 giây giữa hai lần phát; 10 lần trong 24 giờ trượt. Theo IP: 30 lần trong 1 giờ trượt. Ngân sách ZNS: 500 tin/ngày (ngày theo Asia/Ho_Chi_Minh) — `ZNS_DAILY_BUDGET`.
- Số điện thoại lưu `+84` + 9 chữ số, chữ số đầu sau `+84` ∈ {3,5,7,8,9}.
- Phiên học viên: tuyệt đối 90 ngày, nhàn rỗi 37 ngày, xoay khi token ≥ 7 ngày, cửa sổ token cũ 2 phút, lịch sử token 37 ngày, `last_seen_at` cập nhật khi đã ≥ 5 phút. Quản trị: tuyệt đối 12 giờ, nhàn rỗi 1 giờ, không xoay.
- `MAX_DEVICES = 2` (cấu hình, chờ G10). Vé đăng nhập 10 phút. State OIDC 10 phút. Link email quản trị 15 phút. Lời mời 7 ngày. Xác thực gần đây: `now − auth_at < 10 phút`.
- Mọi thời hạn: còn hiệu lực khi `now < expires_at` (đúng bằng `expires_at` là hết hạn).
- Phản hồi gửi mã, gửi link quản trị, xác minh: trung tính (Task 8, 11).
- Mã OTP, token phiên/vé/link/state thô không bao giờ xuất hiện trong DB, log ứng dụng hay outbox (test bắt log và quét DB).
- Bộ gửi giả `FakeEmailSink` chỉ giữ thư trong bộ nhớ, **không ghi log**; khi `NODE_ENV=development` trang `/dev/thu` đọc từ bộ nhớ này. Không có adapter email thật trong P1 (G7).
- Văn bản hiển thị tiếng Việt.

## Review Focus

1. **Hai tab/hai request cùng lúc** (gửi mã, xác minh mã, tranh chỗ thiết bị cuối, hai vé cùng thay một máy, hai chủ hạ quyền nhau): đúng một kết quả hợp lệ, không 500 — Task 6, 7, 8, 11.
2. **Mất phản hồi khi xoay token** trên tàu: không bị đăng xuất; khởi động lại tiến trình giữa chừng vẫn cấp lại được — Task 4.
3. **Số điện thoại nhập đủ kiểu**: chuẩn hóa đúng hoặc từ chối rõ — Task 3.
4. **Cùng trình duyệt có cả hai cookie**: phiên khu vực này không bao giờ được nhận ở khu vực kia; header phân loại do client gửi bị bỏ qua — Task 5.
5. **Dò xem email có tài khoản không** qua gửi/xác minh mã: phản hồi y hệt — Task 8.

---

## File Structure

```
.gitignore .env.example package.json pnpm-lock.yaml tsconfig.json next.config.ts vitest.config.ts prisma.config.ts
docker-compose.dev.yml  docker/postgres-init.sql          # tạo DB me_dev, me_test, me_shadow; vai trò me_migrator (CREATEDB chỉ ở dev), me_app
prisma/schema.prisma
prisma/migrations/0001_auth_baseline/migration.sql       # Prisma sinh + SQL tay (CHECK, index một phần, trigger, GRANT)
prisma/migrations/0002_admin_owner_guard/migration.sql
src/proxy.ts                                              # Next 16 thay middleware.ts (xác nhận ở Task 1)
src/lib/{env,db,crypto,http,clock}.ts
src/modules/identity/{phone,email}.ts
src/modules/sessions/{sessions,cookies,envelope,csrf,guards,routes}.ts
src/modules/mail/fake-sink.ts
src/modules/auth-learner/{otp,otp-sender,identities,devices,link}.ts
src/modules/auth-oidc/{google,oidc-states}.ts
src/modules/auth-admin/{admins,email-link,identities,authorize}.ts
src/modules/audit/audit.ts
src/app/api/health/route.ts
src/app/api/auth/learner/{otp/send,otp/verify,device/select,google/start,google/callback,logout}/route.ts
src/app/api/auth/admin/{link/send,link/consume,google/start,google/callback,logout}/route.ts
src/app/api/me/identities/{route.ts,link/start/route.ts,link/complete/route.ts}
src/app/api/quan-tri/admins/route.ts
src/app/(site)/dang-nhap/page.tsx  src/app/quan-tri/dang-nhap/page.tsx  src/app/dev/thu/page.tsx
src/worker/cli.ts
tests/helpers/{db,http,log-capture,time}.ts
tests/unit/**  tests/integration/**
```

## Schema contract (mọi bảng P1)

Khóa chính `id uuid default gen_random_uuid()`; “now” = `timestamptz NOT NULL default now()`. NN = NOT NULL.

| Bảng | Cột | Khóa / ràng buộc |
| --- | --- | --- |
| `users` | display_name text NN; rank text NULL; status text NN default `'active'`; merged_into_id uuid NULL FK users; created_at now | CHECK status ∈ (active, disabled, merged); CHECK (status='merged') = (merged_into_id IS NOT NULL); trigger chặn vòng gộp |
| `user_identities` | user_id uuid NN FK; kind text NN; value_canonical text NN; verified_at timestamptz NN; created_at now | UNIQUE(kind, value_canonical); CHECK kind ∈ (phone,email,google); CHECK kind<>'phone' OR value_canonical ~ `'^\+84[35789][0-9]{8}$'` |
| `devices` | user_id NN FK; device_key_hash text NN; label text NN; registered_at now; last_seen_at NULL; revoked_at NULL | UNIQUE(user_id, device_key_hash) — cùng một bản cài có thể là thiết bị của hai tài khoản (đăng xuất rồi đăng nhập người khác) |
| `learner_sessions` | user_id NN FK; device_id NN FK; token_hash text NN; token_issued_at now; created_at now; auth_at NN; last_seen_at now; absolute_expires_at NN; prev_valid_until NULL; next_token_enc text NULL; revoked_at NULL | UNIQUE(token_hash); CHECK (prev_valid_until IS NULL) = (next_token_enc IS NULL) |
| `session_token_history` | session_id NN FK learner_sessions; token_hash text NN; rotated_at now; detect_until timestamptz NN | UNIQUE(token_hash); không UPDATE (trigger) |
| `login_tickets` | token_hash NN; user_id NN FK; realm text NN default `'learner'`; purpose text NN default `'replace_device'`; device_key_hash NN; device_label NN; created_at now; expires_at NN; used_at NULL | UNIQUE(token_hash); CHECK expires_at = created_at + interval '10 minutes' |
| `otp_challenges` | purpose text NN; kind text NN; value_canonical NN; user_id uuid NULL FK users; code_hmac NN; key_version text NN; attempts int NN default 0; created_at now; expires_at NN; consumed_at NULL; invalidated_at NULL; delivery_failed_at NULL | CHECK purpose ∈ (signup,login,link); CHECK attempts BETWEEN 0 AND 5; CHECK expires_at = created_at + interval '5 minutes'; CHECK (purpose='link') = (user_id IS NOT NULL); UNIQUE một phần (purpose, kind, value_canonical) WHERE consumed_at IS NULL AND invalidated_at IS NULL |
| `otp_send_log` | kind NN; value_canonical NN; ip inet NN; channel text NN; sent_at now; outcome text NN | index (kind, value_canonical, sent_at); index (ip, sent_at); không chứa mã |
| `zns_daily_budget` | day date PK; used int NN default 0 | CHECK used >= 0 |
| `oidc_states` | state_hash NN; realm text NN; intent text NN; user_id NULL FK users; nonce text NN; code_verifier text NN; device_key_hash NULL; device_label NULL; created_at now; expires_at NN; used_at NULL | UNIQUE(state_hash); CHECK intent ∈ (login, link, admin_login); CHECK expires_at = created_at + interval '10 minutes'; CHECK (intent='link') = (user_id IS NOT NULL) |
| `admin_users` | email_lower text NN; role text NN; status text NN; invited_by uuid NULL FK admin_users; invited_at timestamptz NN; invite_expires_at NN; activated_at NULL; created_at now | UNIQUE(email_lower); CHECK role ∈ (owner,support); CHECK status ∈ (invited,active,expired,revoked); CHECK invite_expires_at = invited_at + interval '7 days'; không DELETE (trigger) |
| `admin_identities` | admin_user_id NN FK; google_sub text NN; created_at now | UNIQUE(google_sub); UNIQUE(admin_user_id) |
| `admin_sessions` | admin_user_id NN FK; token_hash NN; created_at now; auth_at NN; last_seen_at now; absolute_expires_at NN; revoked_at NULL | UNIQUE(token_hash) |
| `admin_email_links` | token_hash NN; admin_user_id NN FK; purpose text NN default `'login'`; created_at now; expires_at NN; used_at NULL; invalidated_at NULL | UNIQUE(token_hash); CHECK expires_at = created_at + interval '15 minutes'; không DELETE (trigger) |
| `admin_audit_log` | admin_user_id NULL FK; action text NN; target_type text NN; target_id text NULL; before jsonb NULL; after jsonb NULL; result text NN; reason text NULL; ip inet NULL; at now | CHECK result ∈ (ok,denied); không UPDATE/DELETE (trigger) |

**Vai trò DB (dev/test):** `docker/postgres-init.sql` tạo `me_other` (chỉ dùng cho test quyền) và `me_migrator` (sở hữu schema, chạy migration, sở hữu các hàm `SECURITY DEFINER`) và `me_app` (ứng dụng); DB `me_shadow` cho Prisma Migrate (`SHADOW_DATABASE_URL`). Migration cấp cho `me_app`: SELECT/INSERT/UPDATE mọi bảng P1 **trừ** `admin_users` (chỉ SELECT; mọi thay đổi qua hàm `admin_invite`, `admin_change`, `admin_activate` ở Task 11); DELETE chỉ trên `login_tickets`, `oidc_states`, `session_token_history` (job dọn) và `user_identities` (gỡ liên kết); **không** TRUNCATE, **không** DDL, **không** DELETE trên bảng khác.

---

### Task 1: Khởi tạo repo, Next.js, Postgres dev, khung test

**Files:** Create: `.gitignore`, `.env.example`, `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `docker-compose.dev.yml`, `docker/postgres-init.sql`, `src/lib/{env,db,clock}.ts`, `src/app/api/health/route.ts`, `tests/helpers/{db,log-capture,time}.ts`. Test: `tests/integration/health.test.ts`.

**Interfaces:**
- Produces: `env` (Zod) gồm `DATABASE_URL` (vai trò `me_app`), `MIGRATOR_DATABASE_URL`, `SHADOW_DATABASE_URL`, `SESSION_KEY_LEARNER`, `SESSION_KEY_ADMIN`, `CSRF_KEY_LEARNER`, `CSRF_KEY_ADMIN`, `SESSION_ENC_KEYS` (`k1:<base64>,k2:...`), `SESSION_ENC_KEY_CURRENT`, `OTP_PEPPERS` (`v1:<base64>,...`), `OTP_PEPPER_CURRENT`, `OIDC_STATE_KEY`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ISSUER` (mặc định `https://accounts.google.com`), `ZALO_LOGIN_ENABLED` (mặc định `false`), `ZNS_DAILY_BUDGET` (500), `MAX_DEVICES` (2). Khóa 32 byte; thiếu hoặc sai độ dài → khởi động lỗi rõ ràng.
- `prisma` (khởi tạo bằng `new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) })`); `withTx<T>(fn: (tx: Tx) => Promise<T>, opts?: { lockTimeoutMs?: number; statementTimeoutMs?: number; retries?: number; deadlineAt?: number }): Promise<T>` (mặc định 3000/10000/3; `SET LOCAL lock_timeout`, `statement_timeout`; thử lại khi lỗi 40P01, 40001, 55P03 với giãn cách ngẫu nhiên 20–100 ms; không thử lại khi `Date.now()` đã qua `deadlineAt`).
- `clock.now(): Date` (test đặt qua `setTestNow`); thời điểm ghi DB vẫn lấy `now()` của DB — test điều khiển thời gian DB bằng cách đặt các cột thời gian trực tiếp.
- Test helpers: mỗi **tệp** test integration chạy trên một schema Postgres riêng `test_<hash tên tệp>` tạo từ migration và xóa khi xong; **trước mỗi test** `resetDbForCurrentSchema()` (kết nối `me_migrator`) chạy `TRUNCATE` mọi bảng của schema đó `RESTART IDENTITY CASCADE` và kiểm mọi bảng rỗng; `vitest.config.ts` có hai project `unit` (song song) và `integration` (`maxWorkers: 4`, cô lập bằng schema). `captureLogs()` gom `console.*` và logger ứng dụng.

- [ ] **Step 1:** Ghi `engines.node = ">=24.15 <25"`. `git init`. `.gitignore`: `node_modules`, `.next`, `.env*` trừ `.env.example`, `.codex-review/`, `coverage`.
- [ ] **Step 2:** `pnpm dlx create-next-app@16.4.3 /tmp/me-scaffold --ts --app --eslint --src-dir --no-tailwind --use-pnpm --import-alias "@/*"`; chép tệp sinh ra (trừ `README.md`, `.git`) vào dự án, không ghi đè `CLAUDE.md`, `docs/`. Ghim các gói ở Tech Stack bằng `pnpm add -E`. Xác nhận trong tài liệu đi kèm `node_modules/next` rằng Next 16 dùng `src/proxy.ts`; nếu khác thì dùng tên đúng và sửa plan.
- [ ] **Step 3:** `docker-compose.dev.yml` (`postgres:16`, cổng `55432`, volume `me_pg_dev`, gắn `docker/postgres-init.sql`). `prisma.config.ts` (datasource dùng `MIGRATOR_DATABASE_URL`, shadow `SHADOW_DATABASE_URL`). `prisma/schema.prisma` tối thiểu: `generator client { provider = "prisma-client"; output = "../src/generated/prisma" }`, datasource `postgresql`, chưa có model; rồi `pnpm prisma generate`. `src/lib/db.ts` import `PrismaClient` từ `@/generated/prisma/client` và `PrismaPg` từ `@prisma/adapter-pg`. Thêm `src/generated/` vào `.gitignore`. Script: `db:up`, `db:down`, `db:migrate`, `db:generate`, `test`, `test:unit`, `test:int`, `build` (`build` và `test` chạy `prisma generate` trước).
- [ ] **Step 4: Viết test thất bại** `tests/integration/health.test.ts`: `GET /api/health` → `200 { ok: true, db: "up" }`; DB không kết nối được → `503 { ok: false }`.
- [ ] **Step 5:** `pnpm test:int tests/integration/health.test.ts` → FAIL.
- [ ] **Step 6:** Cài đặt `env.ts`, `db.ts`, `clock.ts`, route health.
- [ ] **Step 7:** PASS. `pnpm lint && pnpm tsc --noEmit && pnpm build` → không lỗi.
- [ ] **Step 8:** `/codex-impl-review`; commit `chore: bootstrap next.js 16 app, postgres dev, test harness`.

### Task 2: Schema P1, ràng buộc, quyền DB

**Files:** Create: `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/0001_auth_baseline/migration.sql`. Test: `tests/integration/schema-auth.test.ts`, `tests/integration/db-privileges.test.ts`.

**Interfaces:** Produces mọi bảng ở *Schema contract* (hàm `admin_change` ở Task 11).

- [ ] **Step 1: Viết test thất bại** — mỗi ràng buộc ở *Schema contract* một test SQL thô, kỳ vọng đúng mã lỗi (23505, 23514, 23503, P0001):
  - `users`: merged thiếu `merged_into_id`; active có `merged_into_id`; vòng A→B, B→A.
  - `user_identities`: trùng `(kind, value)`; phone `0912345678`; phone `+84212345678`; phone hợp lệ OK.
  - `learner_sessions`: `prev_valid_until` có mà `next_token_enc` NULL.
  - `session_token_history`: trùng hash; UPDATE bị chặn.
  - `login_tickets`, `oidc_states`, `otp_challenges`, `admin_email_links`, `admin_users`: thời hạn lệch 1 giây → lỗi check.
  - `otp_challenges`: hai thử thách hiệu lực cùng (purpose, kind, value); `purpose='link'` thiếu `user_id`; `attempts = 6`.
  - `oidc_states`: `intent='link'` thiếu `user_id`; intent lạ.
  - `admin_users`: role lạ, status lạ, DELETE bị chặn. `admin_identities`: trùng `google_sub`. `admin_email_links`: DELETE bị chặn.
  - `admin_audit_log`: UPDATE, DELETE bị chặn.
  - `db-privileges.test.ts` (kết nối `me_app`): `TRUNCATE users` → 42501; `CREATE TABLE x()` → 42501; `DELETE FROM admin_audit_log` → 42501; `DELETE FROM login_tickets` OK.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `schema.prisma` theo contract; `prisma migrate dev --create-only --name auth_baseline`; thêm SQL tay: CHECK, index một phần, trigger, `GRANT`/`REVOKE`.
- [ ] **Step 4:** `pnpm prisma generate`; PASS.
- [ ] **Step 5:** Soát bằng skill `prisma-migration-safety`; `/codex-impl-review`; commit `feat(db): p1 schema with constraints and runtime role grants`.

### Task 3: Tiện ích mã hóa, chuẩn hóa định danh

**Files:** Create: `src/lib/crypto.ts`, `src/modules/identity/phone.ts`, `src/modules/identity/email.ts`. Test: `tests/unit/{crypto,phone,email}.test.ts`.

**Interfaces:** Produces `randomToken(): string`; `hmacHex(key: Buffer, data: string): string`; `safeEqualHex(a: string, b: string): boolean`; `canonicalizeVnPhone(input: string): string | null`; `toZnsFormat(canonical: string): string`; `canonicalizeEmail(input: string): string | null`.

- [ ] **Step 1: Viết test thất bại:**
```ts
it.each([
  ['0912345678', '+84912345678'], ['0912 345 678', '+84912345678'], ['84912345678', '+84912345678'],
  ['+84-912.345.678', '+84912345678'], ['(+84) 912 345 678', '+84912345678'], ['0312345678', '+84312345678'],
  ['+84 0912345678', null], ['0241234567', null], ['091234567', null], ['09123456789', null],
  ['+12025550123', null], ['abc', null], ['', null],
])('canonicalizeVnPhone(%s) = %s', (i, o) => expect(canonicalizeVnPhone(i)).toBe(o));
it('toZnsFormat', () => expect(toZnsFormat('+84912345678')).toBe('0912345678'));
```
  `crypto`: token 43 ký tự, hai lần khác nhau; `safeEqualHex('ab','ab')` true, `('ab','ac')` false, `('ab','abc')` false. `email`: `' A@B.VN '` → `'a@b.vn'`; `'no-at'`, `'a@'`, `'@b.vn'` → null; `'a.b@gmail.com'` giữ nguyên.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(identity): crypto helpers and phone/email canonicalization`.

### Task 4: Lõi phiên, phong bì xoay token, CSRF

**Files:** Create: `src/modules/sessions/{sessions,envelope,csrf,cookies}.ts`. Test: `tests/integration/sessions.test.ts`, `tests/unit/envelope.test.ts`, `tests/unit/csrf.test.ts`.

**Interfaces:**
- Produces: `type Realm = 'learner' | 'admin'`;
  `createSession(tx, input: { realm: 'learner'; userId: string; deviceId: string; authAt: Date } | { realm: 'admin'; adminId: string; authAt: Date }): Promise<{ sessionId: string; token: string; csrf: string }>` (học viên: khóa và kiểm `users.status = 'active'`, nếu không ném `InactiveUserError`);
  `validateSession(realm, token: string): Promise<SessionView | null>` với `SessionView = { sessionId; subjectId; deviceId?: string; authAt: Date; reissue?: { token: string; csrf: string } }` — kiểm trong DB: chưa thu hồi, chưa hết tuyệt đối/nhàn rỗi, (học viên) thiết bị chưa thu hồi và `users.status = 'active'`, (quản trị) `admin_users.status = 'active'`; token khớp dòng lịch sử **mới nhất** khi còn trong cửa sổ → `reissue` token hiện tại; khớp dòng lịch sử nào khác còn `detect_until` (hoặc mới nhất nhưng hết cửa sổ) → thu hồi phiên, trả null;
  `rotateIfDue(sessionId: string): Promise<{ token: string; csrf: string } | null>` (chỉ học viên; khóa dòng `FOR UPDATE`; xoay khi `now − token_issued_at ≥ 7 ngày`; ghi `session_token_history` với `detect_until = now + 37 ngày`);
  `revokeSession(tx, realm, sessionId)`, `revokeAllForSubject(tx, realm, subjectId)`, `revokeSessionsForDevice(tx, deviceId)`;
  `cleanupSessionArtifacts(now?: Date): Promise<void>` (xóa phong bì hết cửa sổ, lịch sử quá `detect_until`, vé/state hết hạn — job P4 gọi);
  `isRecentAuth(authAt: Date): boolean`;
  `sealNextToken(input: { realm; sessionId; newTokenHash; token }): string`; `openNextToken(envelope: string, aad: { realm; sessionId; newTokenHash }): string | null`;
  `csrfFor(realm, sessionId): string`; `checkCsrf(realm, sessionId, header: string | null): boolean`;
  `sessionCookies(realm, token, csrf): string[]`; `clearSessionCookies(realm): string[]`.
- [ ] **Step 1: Viết test thất bại** (điều khiển thời gian bằng cách đặt cột thời gian trong DB):
  - token hợp lệ → subject; quét mọi cột mọi bảng → không có token thô.
  - Học viên nhàn rỗi: `last_seen + 37d − 1ms` hợp lệ, `+37d` null. Tuyệt đối: `created + 90d − 1ms` hợp lệ, `+90d` null dù dùng đều.
  - Quản trị: nhàn rỗi `1h − 1ms`/`1h`; tuyệt đối `12h − 1ms`/`12h`.
  - `last_seen_at` không đổi nếu lần trước < 5 phút; đổi khi ≥ 5 phút.
  - Thiết bị bị thu hồi → phiên null ngay request kế. User chuyển sang `disabled` hoặc `merged` → phiên null ngay request kế.
  - Xoay: `token_issued_at + 7d − 1ms` không xoay, `+7d` xoay. Token cũ ở `+2m − 1ms` → hợp lệ, `reissue.token` = token hiện tại; ở `+2m` → null **và** phiên bị thu hồi; tạo PrismaClient mới (giả lập khởi động lại) trong cửa sổ → vẫn cấp lại; `cleanupSessionArtifacts` sau cửa sổ xóa `next_token_enc`.
  - Lịch sử: xoay 3 lần trong 30 ngày, dùng token đời đầu → phiên bị thu hồi; dòng ở `detect_until − 1ms` vẫn phát hiện; sau `cleanupSessionArtifacts` qua `detect_until` thì token đó chỉ null (phiên khác của người đó không bị thu hồi).
  - Hai `rotateIfDue` song song → đúng một lần xoay; lần kia `null`, token hiện tại vẫn hợp lệ.
  - Phong bì: sửa 1 byte ciphertext → null; `kid` lạ → null; phong bì phiên A mở với AAD phiên B → null; đổi `SESSION_ENC_KEY_CURRENT` sang `k2` trong cửa sổ (giữ `k1`) → vẫn mở phong bì cũ.
  - CSRF: đúng → true; thiếu/sai/của phiên khác/của khu vực khác → false.
  - Token học viên đưa vào `validateSession('admin', …)` → null.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(sessions): db-backed sessions, rotation envelope, csrf`.

### Task 5: Phân loại đường dẫn, guard, cookie và đăng xuất

**Files:** Create: `src/proxy.ts`, `src/modules/sessions/{routes,guards}.ts`, `src/lib/http.ts`, `src/app/api/auth/learner/logout/route.ts`, `src/app/api/auth/admin/logout/route.ts`. Test: `tests/integration/routes.test.ts`, `tests/integration/logout.test.ts`.

**Interfaces:**
- Produces: `classifyPath(pathname: string): 'public' | 'provider' | 'auth' | 'learner' | 'admin' | 'denied'`:

| Tiền tố | Lớp |
| --- | --- |
| `/`, `/khoa-hoc/**`, `/dang-nhap/**`, `/quan-tri/dang-nhap`, `/_next/**`, `/api/public/**`, `/api/health` | public |
| `/dev/**` | public khi `NODE_ENV=development`, ngược lại denied |
| `/api/payments/sepay/webhook` | provider |
| `/api/auth/learner/**`, `/api/auth/admin/**` | auth |
| `/hoc/**`, `/tai-khoan/**`, `/api/learn/**`, `/api/me/**` | learner |
| `/quan-tri/**` (trừ `/quan-tri/dang-nhap`), `/api/quan-tri/**` | admin |
| `/api/**` khác | denied (404) |
| trang khác | public |

  `requireLearner(req): Promise<LearnerCtx>` (`{ userId; deviceId; sessionId; authAt; ip }`), `requireAdmin(req): Promise<AdminCtx>` (`{ adminId; role; sessionId; authAt; ip }`) — đọc cookie đúng khu vực, `validateSession`, với method thay đổi trạng thái thì kiểm `Origin` + `checkCsrf`; ném `HttpError(401|403)`; nếu có `reissue` thì đính cookie mới vào phản hồi; `HttpError`, `json(data, init?)`.
  Proxy **xóa** mọi header `x-me-*` từ request rồi mới gắn `x-me-realm`; handler không dùng header này để cấp quyền.
- [ ] **Step 1: Viết test thất bại:** bảng trên dạng `it.each` qua `classifyPath`; chỉ cookie học viên → `/api/quan-tri/admins` 401; chỉ cookie quản trị → `/api/me/identities` 401; có cả hai → mỗi bên chỉ nhận đúng khu vực; client gửi `x-me-realm: admin` kèm cookie học viên → vẫn 401; gọi handler trực tiếp (bỏ proxy) → vẫn 401; POST có phiên nhưng thiếu `x-csrf-token` → 403; sai `Origin` → 403; `/api/khong-co` → 404; `/dev/thu` khi production → 404. Đăng xuất học viên: phiên học viên bị thu hồi, phiên quản trị cùng trình duyệt vẫn hợp lệ, và ngược lại; `Set-Cookie` có đủ thuộc tính ở Global Constraints; cookie bị xóa có `Max-Age=0`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(auth): route classification, realm guards, csrf, logout`.

### Task 6: Phát mã OTP

**Files:** Create: `src/modules/auth-learner/{otp,otp-sender}.ts`, `src/modules/mail/contracts.ts`, `src/modules/mail/fake-sink.ts`. Test: `tests/integration/otp-issue.test.ts`.

**Interfaces:**
- Produces: `type OtpPurpose = 'signup' | 'login' | 'link'`; `type OtpKind = 'email' | 'phone'`;
  `issueOtp(input: { purpose; kind; value: string; ip: string; userId?: string; create: boolean }, sender: OtpSender): Promise<'sent' | 'throttled' | 'skipped' | 'delivery_failed'>` — `create=false` vẫn kiểm và tính hạn mức nhưng không tạo thử thách, không gửi, trả `'skipped'`;
  `src/modules/mail/contracts.ts` khai báo **cả hai** hợp đồng: `interface OtpSender { send(kind: OtpKind, valueCanonical: string, code: string): Promise<void> }` và `interface AdminLinkSender { sendAdminLink(email: string, url: string): Promise<void> }` (Task 11 dùng lại, không khai báo lại); `FakeEmailSink implements OtpSender, AdminLinkSender` (`messages(): { to; kind; body }[]`, `clear()`; không log); `ZaloZnsSender` (ném `ZaloDisabledError` khi `ZALO_LOGIN_ENABLED=false`).
- [ ] **Step 1: Viết test thất bại:**
  - Lần đầu → `sent`; một thử thách hiệu lực; `code_hmac` ≠ mã; quét DB và log đã bắt → không có mã.
  - Khoảng chờ: lần hai ở `+60s − 1ms` → `throttled` (kể cả purpose khác); ở `+60s` → `sent`, thử thách cũ `invalidated_at`.
  - 10 lần/24 giờ một định danh (mọi purpose cộng) → lần 11 `throttled`; lần 11 ở đúng `lần 1 + 24h` → `sent`.
  - IP: lần 31 trong 1 giờ (định danh khác nhau) → `throttled`.
  - 5 lời gọi song song cùng định danh (purpose khác nhau) → đúng 1 `sent`; 5 lời gọi song song khác định danh cùng IP khi còn 1 lượt IP → đúng 1 `sent`.
  - Ngân sách ZNS (bật Zalo với sender giả): `ZNS_DAILY_BUDGET=3`, 5 số khác nhau song song → đúng 3 `sent`; sang 00:00 Asia/Ho_Chi_Minh → gửi lại được.
  - Sender ném lỗi → `delivery_failed`, có `delivery_failed_at`, hạn mức vẫn bị tính. Zalo tắt → `delivery_failed`, không gọi mạng.
  - `create=false` → `skipped`, hạn mức có tính, không có thử thách, sink không có thư.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt: `withTx` → `pg_advisory_xact_lock(hashtext('otp-id:'||kind||':'||value))` rồi `pg_advisory_xact_lock(hashtext('otp-ip:'||ip))` (luôn theo thứ tự này) → đếm `otp_send_log` theo cửa sổ trượt → (phone) upsert và khóa dòng `zns_daily_budget` của ngày `FOR UPDATE` → ghi `otp_send_log` → hủy thử thách cũ → chèn mới → commit → **sau commit** gọi `sender.send`. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(otp): issue codes with locking and layered limits`.

### Task 7: Xác minh mã OTP

**Files:** Modify: `src/modules/auth-learner/otp.ts`. Test: `tests/integration/otp-verify.test.ts`.

**Interfaces:** Produces `verifyOtp(tx, input: { purpose; kind; value: string; code: string; userId?: string }): Promise<'ok' | 'invalid'>` (chạy trong transaction của người gọi); `rotateOtpPepper(newVersion: string): Promise<number>`.

- [ ] **Step 1: Viết test thất bại:** đúng → `ok`, `consumed_at` có; dùng lại → `invalid`; purpose khác → `invalid`; `userId` khác với thử thách link → `invalid`; 5 lần sai → lần 6 kể cả đúng → `invalid` và thử thách `invalidated_at`; biên `expires_at − 1ms` → `ok`, `expires_at` → `invalid`; 2 lời gọi song song cùng mã đúng → đúng 1 `ok`; sau `rotateOtpPepper('v2')` mã cũ → `invalid`, mã phát sau dùng `key_version='v2'`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt: `SELECT … FOR UPDATE` thử thách chưa dùng/chưa hủy → kiểm `expires_at > now()` khi giữ khóa → HMAC trong app → `safeEqualHex` → cập nhật. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(otp): atomic verification with attempt limit`.

### Task 8: Đăng ký/đăng nhập học viên bằng email, thiết bị, vé

**Files:** Create: `src/modules/auth-learner/{identities,devices}.ts`, routes `src/app/api/auth/learner/{otp/send,otp/verify,device/select}/route.ts`, trang `src/app/(site)/dang-nhap/page.tsx`, `src/app/dev/thu/page.tsx`. Test: `tests/integration/learner-login.test.ts`, `tests/integration/devices.test.ts`.

**Interfaces:**
- Consumes: `issueOtp`, `verifyOtp`, `createSession`, `revokeSessionsForDevice`, `canonicalizeEmail`.
- **Khóa thiết bị:** trình duyệt sinh 32 byte bằng `crypto.getRandomValues`, mã base64url (43 ký tự), lưu bền trong IndexedDB (dự phòng `localStorage`). **Đăng xuất bình thường giữ nguyên khóa** (đăng nhập lại dùng lại thiết bị cũ, không tốn chỗ). **Đổi sang tài khoản khác** trên cùng bản cài: route đăng xuất nhận `{ switchAccount: true }` → thu hồi thiết bị hiện tại của người cũ, client sinh khóa mới. Khóa của một thiết bị đã bị thu hồi từ xa đăng nhập lại → `completeLearnerAuth` **kích hoạt lại** dòng cũ (`revoked_at = NULL`, cập nhật `last_seen_at`) nhưng tính như thiết bị mới đối với `MAX_DEVICES` (đủ chỗ thì kích hoạt, hết chỗ thì vé thay máy); không bao giờ chèn dòng trùng `(user_id, device_key_hash)`. Máy chủ chỉ nhận khóa khớp `^[A-Za-z0-9_-]{43}$` (sai → 400) và chỉ lưu `HMAC(SESSION_KEY_LEARNER, deviceKey)`.
- Produces: `hashDeviceKey(deviceKey: string): string` (kiểm định dạng); `completeLearnerAuth(tx, input: { userId: string; deviceKeyHash: string; deviceLabel: string; authAt: Date })`: Promise<{ kind: 'session'; token: string; csrf: string } | { kind: 'choose_device'; ticket: string; devices: { id: string; label: string; lastSeenAt: Date | null }[] }>` (khóa `users FOR UPDATE`; user không `active` → ném `InactiveUserError` (route trả `{ next: 'invalid' }`); thiết bị chưa thu hồi cùng `device_key_hash` của chính người đó → dùng lại; đủ `MAX_DEVICES` → tạo `login_tickets` với `device_key_hash`); route OTP gọi `hashDeviceKey` rồi truyền hash, callback Google truyền thẳng `oidc_states.device_key_hash`;
  `consumeTicketAndReplace(input: { ticket: string; deviceKey: string; replaceDeviceId: string }): Promise<{ token: string; csrf: string } | null>` (một transaction: `UPDATE login_tickets SET used_at = now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() AND realm='learner' AND purpose='replace_device' RETURNING` → kiểm `device_key_hash = HMAC(deviceKey)` → khóa `users` → kiểm `replaceDeviceId` thuộc người đó và chưa thu hồi → thu hồi nó và phiên của nó → tạo thiết bị + phiên);
  `findUserIdByIdentity(tx, kind, value): Promise<string | null>`; `createUserWithIdentity(tx, input: { kind; value; displayName: string; rank: string | null }): Promise<string>`.
- **Hợp đồng chống dò:** `POST /api/auth/learner/otp/send` `{ contact, displayName?, rank? }` (không có `purpose`) → luôn `200 { ok: true }`; định danh đã có → phát mã purpose `login`; chưa có và có `displayName` → purpose `signup`; chưa có và thiếu `displayName` → `issueOtp(create=false)`. `POST …/otp/verify` `{ contact, code, deviceKey, deviceLabel, displayName?, rank? }` → `200 { next: 'done' }` + cookie phiên/CSRF, `200 { next: 'choose_device', devices }` + cookie vé, hoặc `200 { next: 'invalid' }` (mã sai, hết hạn, không có thử thách, định danh không tồn tại — **cùng một body**). Signup với định danh đã có xử lý như login.
- [ ] **Step 1: Viết test thất bại:**
  - Đăng ký email mới → `users` + `user_identities` + `devices` + phiên; đăng nhập lại → không tạo user mới.
  - Đăng xuất rồi đăng nhập lại 3 lần cùng khóa → vẫn 1 thiết bị. Đăng xuất `switchAccount` → thiết bị cũ bị thu hồi. Thiết bị bị thu hồi từ xa đăng nhập lại khi còn chỗ → dòng cũ được kích hoạt lại; khi đã đủ 2 máy khác → `choose_device`; không lỗi 500, không vượt 2.
  - User `disabled` hoặc `merged`: mã đúng → `{ next: 'invalid' }`, không có phiên. Khóa thiết bị sai định dạng → 400. Cùng một khóa thiết bị đăng nhập lần lượt hai tài khoản → mỗi tài khoản có dòng `devices` riêng.
  - Ma trận chống dò: (định danh có / không có) × (send / verify mã sai) → body và mã trạng thái giống hệt; sink chỉ có thư khi định danh có, hoặc signup có `displayName`.
  - Thiết bị: máy thứ ba → `choose_device`, chưa có phiên; chọn thay → máy cũ `revoked_at`, phiên máy cũ null, phiên mới hợp lệ.
  - Vé: dùng lại → null; `created + 10m − 1ms` dùng được, `+10m` null; `deviceKey` khác lúc tạo vé → null; `replaceDeviceId` của người khác → null; thiết bị đã thu hồi/không tồn tại → null; sửa cookie vé → null; cookie vé gửi tới route quản trị → 401.
  - Song song: hai lần đăng nhập khác nhau (hai `deviceKey` mới) khi còn đúng 1 chỗ → một `session`, một `choose_device`; hai vé khác nhau cùng thay một máy cũ → một thành công, một null; hai `device/select` cùng một vé → một thành công. Số thiết bị hoạt động không bao giờ > 2.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. Trang `/dang-nhap` theo màn `Login` của giao diện v1 (tên hiển thị, liên hệ email, chức danh, nút Google, ô mã 6 số; ghi chú “Đăng nhập bằng số điện thoại qua Zalo sẽ mở sau” khi Zalo tắt); `/dang-nhap/chon-thiet-bi` cho bước thay máy; `/dev/thu` liệt kê thư trong `FakeEmailSink`. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(auth): learner email login with device limit and tickets`.

### Task 9: Google OIDC cho học viên

**Files:** Create: `src/modules/auth-oidc/{google,oidc-states}.ts`, routes `src/app/api/auth/learner/google/{start,callback}/route.ts`. Test: `tests/integration/google-learner.test.ts` (issuer giả bằng `oauth2-mock-server`).

**Interfaces:**
- Produces: `createOidcState(tx, input: { realm: Realm; intent: 'login' | 'link' | 'admin_login'; userId?: string; deviceKey?: string; deviceLabel?: string }): Promise<{ cookieValue: string; state: string; nonce: string; codeVerifier: string }>` (lưu `oidc_states` với hash; `cookieValue = stateId.HMAC(OIDC_STATE_KEY, stateId)`);
  `consumeOidcState(tx, realm, cookieValue: string, stateParam: string): Promise<OidcStateRow | null>` (`UPDATE oidc_states SET used_at = now() WHERE id=$1 AND state_hash=$2 AND realm=$3 AND used_at IS NULL AND expires_at > now() RETURNING *`);
  `exchangeAndVerify(realm, url: URL, st: OidcStateRow): Promise<{ sub: string; email: string | null; emailVerified: boolean } | null>` (`openid-client`, PKCE S256, kiểm `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud`, `exp`, `nonce`; redirect URI `${APP_ORIGIN}/api/auth/${realm}/google/callback`);
  `POST /api/auth/learner/google/start` `{ deviceKey, deviceLabel }` (intent `login`) → `{ redirectUrl }` + cookie state; `GET …/callback`: `google_sub` đã có → `completeLearnerAuth`; chưa có và `emailVerified` → tạo user (tên hiển thị = phần trước `@`, rank NULL) + identity google (+ identity email nếu email chưa thuộc ai) — chèn identity google bằng `ON CONFLICT DO NOTHING`; nếu thua tranh chấp (callback khác vừa tạo cùng `sub`) thì bỏ user vừa tạo trong transaction (savepoint) và dùng user đã có; identity email cũng `ON CONFLICT DO NOTHING` (đã thuộc người khác thì bỏ qua) → `completeLearnerAuth`; chưa có và **không** `emailVerified` → không tạo gì, chuyển về `/dang-nhap?loi=google`. Callback với `intent='link'` gọi luồng Task 10. Thành công chuyển tới `/hoc` hoặc `/dang-nhap/chon-thiet-bi`; luôn xóa cookie state.
- [ ] **Step 1: Viết test thất bại:** luồng đúng → phiên; `state` sai → không phiên; replay callback → không phiên; hai callback song song cùng state → một phiên; state `created + 10m − 1ms` dùng được, `+10m` không; `nonce` sai, `aud` sai, `iss` lạ → không phiên; `iss = accounts.google.com` → được; lần đầu `email_verified=false` → không có user/identity/device/phiên; email đã thuộc tài khoản khác → user mới chỉ có identity google; cookie state learner đưa vào callback admin → từ chối; cookie state có `Max-Age=0` sau callback; máy thứ ba qua Google → `choose_device`. Hai callback hợp lệ **khác state** cùng một `sub` mới chạy song song → đúng một user, cả hai nhận phiên của user đó. Hai `sub` mới khác nhau cùng một email đã xác minh, song song → hai user, chỉ một có identity email. User `disabled` đăng nhập qua Google → không phiên.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(auth): learner google oidc with one-time server state`.

### Task 10: Liên kết và gỡ định danh

**Files:** Create: `src/modules/auth-learner/link.ts`, routes `src/app/api/me/identities/route.ts` (GET, DELETE `?id=`), `src/app/api/me/identities/link/{start,complete}/route.ts`. Modify: `src/app/api/auth/learner/google/callback/route.ts`. Test: `tests/integration/identities-link.test.ts`.

**Interfaces:**
- Produces: `startLink(ctx: LearnerCtx, input: { kind: 'email' | 'phone'; contact: string } | { kind: 'google' }): Promise<{ status: 'sent' | 'throttled' | 'reauth_required' } | { status: 'redirect'; redirectUrl: string }>` (email/phone: `issueOtp` purpose `link` gắn `userId`; google: `createOidcState(intent 'link', userId)`);
  `completeLinkOtp(ctx, input: { kind; contact; code }): Promise<'linked' | 'invalid' | 'reauth_required' | 'owned_by_other'>` (một transaction: `verifyOtp(purpose 'link', userId)` → khóa `users` → `INSERT … ON CONFLICT (kind, value_canonical) DO NOTHING RETURNING`; không có dòng trả về → định danh đã thuộc người khác (`owned_by_other`) hoặc của chính mình (`linked`) — **mã OTP vẫn được tiêu thụ và transaction commit**);
  `completeLinkGoogle(ctx, st: OidcStateRow, claims): Promise<'linked' | 'owned_by_other' | 'invalid'>` (yêu cầu `st.userId === ctx.userId`; chỉ gắn `google_sub`);
  `unlinkIdentity(ctx, identityId): Promise<'unlinked' | 'reauth_required' | 'last_identity' | 'not_found'>` (khóa `users`, cần ≥ 2 định danh).
  Mọi lệnh thay đổi cần `isRecentAuth(ctx.authAt)`.
- [ ] **Step 1: Viết test thất bại:** link email khi `authAt = now − 10m + 1ms` → được; `now − 10m` → `reauth_required`; mã link của user A dùng với phiên user B → `invalid`; email đã thuộc người khác → `owned_by_other`, không đổi; dùng lại chính mã đó sau `owned_by_other` → `invalid`; dùng lại mã → `invalid`; Google link `sub` mới → `linked`; `sub` đã thuộc người khác → `owned_by_other`; replay callback link → không gắn lần hai; state link của A dùng khi đăng nhập B → `invalid`; gỡ khi còn 2 → `unlinked`; gỡ cái cuối → `last_identity`; hai lệnh gỡ song song khi còn 2 → đúng một `unlinked`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(auth): link and unlink learner identities with proof`.

### Task 11: Tài khoản quản trị, đăng nhập quản trị, nhật ký

**Files:** Create: `prisma/migrations/0002_admin_owner_guard/migration.sql`, `src/modules/auth-admin/{admins,email-link,identities}.ts`, `src/modules/audit/audit.ts`, `src/worker/cli.ts`, routes `src/app/api/auth/admin/{link/send,link/consume,google/start,google/callback}/route.ts`, `src/app/quan-tri/dang-nhap/page.tsx`. Test: `tests/integration/admins.test.ts`, `tests/integration/admin-login.test.ts`.

**Interfaces:**
- Produces: các hàm SQL `SECURITY DEFINER` (chủ sở hữu `me_migrator`, `SET search_path` cố định) — **đường duy nhất** để đổi `admin_users` vì `me_app` chỉ có SELECT trên bảng này:
  - `admin_change(p_actor uuid, p_admin uuid, p_role text, p_status text) returns void`: `pg_advisory_xact_lock(hashtext('admin-owner-guard'))` → khóa dòng → áp đổi → kiểm còn ≥ 1 owner `active` (không thì `RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001'`) → **thu hồi mọi `admin_sessions` của người bị đổi** và hủy link chưa dùng nếu status không còn `active`/`invited`;
  - `admin_invite(p_actor uuid, p_email text, p_role text) returns text` (`invited` | `already_active`): khóa theo email; mới → chèn; `expired`, `revoked`, **hoặc `invited` mà `now() >= invite_expires_at`** → về `invited`, `invited_at = now()`, hạn mới, hủy link chưa dùng, thu hồi phiên; `invited` còn hạn → cập nhật role, giữ hạn cũ, trả `invited`;
  - `admin_activate(p_admin uuid) returns void`: chỉ từ `invited` còn hạn sang `active`, đặt `activated_at`;
  - trigger `BEFORE UPDATE` trên `admin_users` lấy cùng khóa và kiểm cùng điều kiện chủ cuối (chặn cả đường của `me_migrator`);
  - **Quyền gọi hàm** (cùng migration, cùng transaction): `REVOKE ALL ON FUNCTION admin_invite(uuid,text,text), admin_change(uuid,uuid,text,text), admin_activate(uuid) FROM PUBLIC`; `GRANT EXECUTE` đúng chữ ký đó cho `me_app` (và `me_migrator` là chủ sở hữu);
  `audit(tx, entry: { adminId: string | null; action: string; targetType: string; targetId: string | null; before?: unknown; after?: unknown; result: 'ok' | 'denied'; reason?: string; ip?: string }): Promise<void>`; `auditDenied(entry): Promise<void>` (transaction riêng, dùng sau rollback);
  `inviteAdmin(ctx: AdminCtx, input: { email: string; role: 'owner' | 'support' }): Promise<'invited' | 'already_active' | 'invalid_email'>` (chuẩn hóa email rồi gọi `admin_invite`);
  `changeAdmin(ctx, adminId, change: { role?; status? }): Promise<'ok' | 'last_owner'>` (gọi `admin_change`);
  `AdminLinkSender` lấy từ `src/modules/mail/contracts.ts` (Task 6); P1 dùng `FakeEmailSink`;
  `issueAdminLink(email: string, sender: AdminLinkSender): Promise<void>` (phản hồi route luôn như nhau; chỉ tạo/gửi khi email `active` hoặc `invited` còn hạn; gửi **sau commit**);
  `consumeAdminLink(token: string): Promise<{ token: string; csrf: string } | null>` (một transaction: `UPDATE admin_email_links SET used_at = now() WHERE token_hash=$1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > now() RETURNING` → khóa `admin_users` → `active`, hoặc `invited` với `now < invite_expires_at` → `admin_activate` → `createSession('admin')` → audit → commit);
  Google quản trị: `POST /api/auth/admin/google/start` (intent `admin_login`) → callback: `google_sub` có trong `admin_identities` → admin đó, phải `active`; chưa có → cần `email_verified` và email khớp admin `active` hoặc `invited` còn hạn → chèn `admin_identities` (unique; xung đột → từ chối) và gọi `admin_activate` nếu đang mời → phiên quản trị. Đổi email Google về sau không ảnh hưởng (đăng nhập theo `sub`).
  CLI (chạy trên máy chủ bằng `MIGRATOR_DATABASE_URL`): `pnpm cli admin:bootstrap <email>` — chỉ khi chưa có owner nào; tạo owner `active`; audit `adminId = null`, action `bootstrap`. `pnpm cli admin:recover <email> --reason "<lý do>" --confirm <email>` — khôi phục khẩn cấp khi mất quyền vào tài khoản chủ: yêu cầu `--confirm` trùng email và lý do ≥ 10 ký tự; khóa `admin-owner-guard`; email chưa có → tạo owner `active`; có rồi → đặt `role=owner`, `status=active`; xóa `admin_identities` của người đó (gắn lại Google từ đầu), hủy mọi link, thu hồi mọi phiên của người đó; audit action `emergency_recover` kèm lý do.
- [ ] **Step 1: Viết test thất bại:**
  - Bootstrap tạo owner; lần hai → báo đã có owner, không đổi. `admin:recover` thiếu `--confirm` đúng email hoặc lý do ngắn → từ chối, không đổi gì; hợp lệ → người đó là owner `active`, phiên cũ null, `admin_identities` bị xóa, có dòng audit `emergency_recover`.
  - Quyền DB: kết nối `me_app` chạy `UPDATE admin_users SET role='owner'` → 42501. `me_app` gọi được `admin_change`; vai trò `me_other` (tạo sẵn trong `docker/postgres-init.sql`: `LOGIN`, `CONNECT` vào `me_test`; test setup bằng `me_migrator` cấp `USAGE` trên schema của tệp test, **không** cấp `EXECUTE`) gọi `admin_change` → 42501 tại bước gọi hàm. Đổi một admin **không phải chủ cuối** (support → revoked) qua `admin_change` → phiên của người đó null ngay.
  - Mời: lời mời `invited` để quá hạn tự nhiên (không qua job) rồi mời lại ở đúng `invite_expires_at` → `invited` với hạn mới; ở `invite_expires_at − 1ms` → giữ hạn cũ; hai lời mời lại song song → một bản ghi, hạn mới nhất quán.
  - Mời: email mới → `invited`; link ở `invite_expires_at − 1ms` kích hoạt được, ở `invite_expires_at` → null; mời lại email `expired` → `invited` mới, link cũ bị hủy; mời lại email `revoked` → như trên, phiên cũ đã thu hồi; mời song song cùng email → một bản ghi, không lỗi 500.
  - Link: `created + 15m − 1ms` được, `+15m` null; dùng hai lần **song song** → đúng một phiên; admin `revoked` với link còn hạn → null; quét DB và log → không có token thô; `issueAdminLink` email không tồn tại → không có thư, phản hồi route giống hệt email có thật.
  - Google: `sub` mới + email khớp admin `invited` → kích hoạt + phiên; `email_verified=false` → từ chối; email không có trong danh sách → từ chối; `sub` đã gắn admin khác → từ chối; hai callback kích hoạt song song cùng admin → một `admin_identities`, admin `active`.
  - Chủ cuối: hạ quyền owner duy nhất → `last_owner`; hai owner hạ quyền nhau song song → còn đúng một owner; `UPDATE admin_users SET role='support'` thô bằng `me_migrator` cho owner cuối → lỗi trigger.
  - Đổi role → mọi phiên quản trị của người đó null ngay.
  - Nhật ký: mỗi thao tác thành công có dòng `ok`; thao tác bị từ chối (last_owner, link không hợp lệ của admin có thật) có dòng `denied`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. Trang `/quan-tri/dang-nhap`: nút Google, ô email gửi link. **Step 4:** PASS.
- [ ] **Step 5:** `/codex-impl-review`; commit `feat(admin): invites, email links, google admin login, last-owner guard, audit`.

### Task 12: Ủy quyền quản trị có ngữ cảnh, API quản lý quản trị

**Files:** Create: `src/modules/auth-admin/authorize.ts`, `src/app/api/quan-tri/admins/route.ts`. Test: `tests/integration/authorize.test.ts`.

**Interfaces:**
- Produces: `type Permission = 'orders.view' | 'payments.match' | 'grants.create' | 'refunds.request' | 'refunds.approve' | 'accounts.merge' | 'prices.edit' | 'coupons.edit' | 'data.export' | 'admins.manage' | 'bank.raw.view' | 'learner.phone.view' | 'devices.remove' | 'jobs.run'`;
  `POLICY: Record<Permission, { roles: ReadonlyArray<'owner' | 'support'>; recentAuth?: boolean; condition?: (ctx: AdminCtx, resource?: ResourceCtx) => boolean }>` theo DG §5 (đề xuất, chờ G11): owner có mọi quyền; support có `orders.view`, `payments.match`, `refunds.request`, `devices.remove`, và `bank.raw.view`, `learner.phone.view` **chỉ khi** `resource.assignedAdminId === ctx.adminId`; `recentAuth: true` cho `refunds.approve`, `accounts.merge`, `data.export`, `admins.manage`, `prices.edit`, `coupons.edit`, `grants.create`;
  `type ResourceCtx = { type: string; id: string; assignedAdminId?: string | null }`;
  `authorize(ctx: AdminCtx, perm: Permission, input: { action: string; resource?: ResourceCtx }): Promise<void>` — từ chối → `auditDenied({ reason: 'role' | 'reauth_required' | 'condition', … })` rồi ném `HttpError(403, reason)`;
  `GET /api/quan-tri/admins` (`admins.manage`), `POST` (mời), `PATCH` (đổi role/status, `409 last_owner` + audit `denied`).
- [ ] **Step 1: Viết test thất bại:** support POST `/api/quan-tri/admins` → 403 `role` + audit `denied`; owner `authAt = now − 10m` → 403 `reauth_required` + audit; owner `now − 10m + 1ms` → được; support `bank.raw.view` với `assignedAdminId` = mình → được, = người khác → 403 `condition` + audit; PATCH hạ owner cuối → 409 + audit `denied`; mọi `Permission` có mục trong `POLICY`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** Toàn bộ `pnpm test`, `pnpm lint`, `pnpm tsc --noEmit`, `pnpm build` → không lỗi. `/codex-impl-review`; commit `feat(admin): contextual authorization and admin management api`.
- [ ] **Step 6:** Cập nhật `CLAUDE.md` (lệnh dev/test/build thật, biến môi trường) và `docs/session-handoff.md`; commit `docs: record p1 commands and status`.

---

## Không nằm trong P1

Đăng nhập số điện thoại qua Zalo bật thật (G6/G15/G12a — chỉ có adapter tắt), email thật (G7 — dùng `FakeEmailSink`), job định kỳ gọi `cleanupSessionArtifacts` (P4; test Task 4 gọi trực tiếp), hồ sơ 8A, gộp tài khoản (P2 cùng quyền học), giao diện đầy đủ theo v1 (P5), tiền (P2), offline (P3), worker/outbox (P4), triển khai (P5).
