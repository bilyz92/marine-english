# P2 — Khóa học, đơn hàng, sổ giao dịch, quyền học — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhập nội dung Engine Cadet thành khóa học có phiên bản, bán khóa bằng đơn có ảnh chụp bất biến và mã `ME…`, ghi mọi giao dịch tiền vào một sổ bất biến (webhook SePay có chữ ký, nhập sao kê + chủ xác minh), tự xác nhận đúng trường hợp hợp lệ, còn lại vào hàng chờ cho ghép tay; hoàn tiền tay; quyền học chỉ đọc từ `enrollments` theo nhóm gộp.

**Architecture:** Hai migration mới (nội dung; tiền) với CHECK, trigger bất biến/chuyển trạng thái và constraint trigger hoãn bảo vệ bất biến ở tầng DB. Mọi đường tiền vào gọi một hàm `ingest()` trong một transaction ngắn, khóa theo thứ tự cố định (dòng sổ theo id tăng dần → đơn → refund). Thông báo chỉ ghi vào `outbox_events` (P4 gửi). Không có giao diện mới ngoài API (giao diện → P5).

**Tech Stack:** như P1 (Next.js 16, Prisma 7 raw SQL qua `$queryRaw`, PostgreSQL 16, Vitest, Zod 4). Không thêm thư viện.

**Spec:** `docs/design-gates-2026-10-30.md` §2, §4 (gộp), §8.6; `docs/technical-design-draft-2026-10-30.md` §3.3–3.5, §4, Phụ lục A; “Payment flow invariants” trong `CLAUDE.md`. Dựa trên giao diện P1: `withTx(fn, opts)`, `Tx`, `requireLearner`, `requireAdmin`, `authorize(ctx, perm, {action, resource})`, `POLICY`, `audit(tx, entry)`, `auditDenied`, `route`, `json`, `readJson`, `HttpError`, `revokeAllForSubject`, `revokeDevice`.

## Global Constraints

- Cổng còn mở: G4 (SePay), G5 (mã đơn), G13 (chính sách hoàn), G14 (giá/mã giảm giá). P2 code theo đề xuất trong DG; chỗ phụ thuộc cổng ghi `[Gx]` trong chú thích mã. Không gọi mạng thật tới SePay.
- **Mã giảm giá để sau (G14):** đơn P2 không có coupon; không tạo bảng `coupons`. Khi G14 chốt, migration riêng thêm cột/bảng.
- **Điều chỉnh hoàn tiền (`refund_adjustments`) để sau (G13);** refund P2 có đủ vòng đời `requested → approved → sent → confirmed` hoặc `failed`/`cancelled`.
- Tiền: số nguyên VND (`integer`), `currency = 'VND'`. Thời điểm: `timestamptz` UTC, DB `now()`.
- Mã đơn: `ME` + 8 ký tự từ bảng `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (bỏ 0/O, 1/I/L), CSPRNG (`crypto.randomInt`), duy nhất trong DB, thử lại khi trùng, quá 5 lần → lỗi `OrderCodeExhaustedError`. [G5]
- Đơn: `expires_at = created_at + interval '15 minutes'` (CHECK). Khoảng hợp lệ của giao dịch: `created_at <= bank_time < expires_at`. Chuyển trạng thái hợp lệ: `pending→paid`, `pending→expired`, `expired→paid`, `paid→refunded`.
- Tự xác nhận **chỉ khi**: đúng một mã đơn hợp lệ trong nội dung, một giao dịch, đúng số tiền, `bank_time` trong khoảng, đơn `pending` hoặc `expired`. Mọi trường hợp khác → hàng chờ. `bank_time` ở tương lai > 5 phút so với giờ DB → hàng chờ `bad_time`.
- Thứ tự khóa (chống deadlock): các dòng `bank_transactions` theo `id` tăng dần → dòng `orders` → dòng `refunds`.
- Quyền học chỉ đọc từ `enrollments` (`revoked_at IS NULL`) theo **nhóm gộp** của học viên; không bao giờ suy ra từ `orders`.
- Không DELETE dữ liệu tiền/nội dung: trigger chặn UPDATE/DELETE trên bảng bất biến; `me_app` không có quyền DELETE trên các bảng mới.
- Webhook: body ≤ 64 KB, chỉ `application/json`, đọc byte gốc trước khi parse; `X-SePay-Timestamp` lệch ≤ 5 phút; chữ ký HMAC-SHA256 so hằng thời gian, thử mọi khóa trong `SEPAY_WEBHOOK_SECRETS`; hạn chót request 8 giây; mỗi lần thử transaction `lock_timeout` 2 s, `statement_timeout` 3 s; chỉ thử lại khi còn ≥ 3,5 s; hết → 503.
- Mọi thao tác tay của quản trị qua `authorize()` với POLICY P1 và ghi `admin_audit_log` (trước/sau, lý do, bằng chứng). Ai làm gì: theo bảng ở Task 9/10 (DG §2.8, đề xuất G11).
- Văn bản hiển thị tiếng Việt. Không log nội dung chuyển khoản đầy đủ, chữ ký hay bí mật.
- Số bài học thử mỗi khóa: 3 (vị trí 1–3 của phiên bản khóa hiện hành).

## Review Focus

1. **Webhook gửi lại / gửi song song cùng giao dịch** (SePay thử lại 7 lần, hai request chồng nhau): đúng một dòng sổ, một phân bổ, một quyền học, một sự kiện outbox; mọi lần trả 200 — Task 6, 7.
2. **Tiền đến muộn sau khi job đã đặt đơn `expired`** nhưng `bank_time` vẫn trong 15 phút: đơn thành `paid`; `bank_time` sau hạn: hàng chờ `late`, đơn giữ `expired` — Task 5, 6.
3. **Nội dung chuyển khoản lộn xộn** (chữ thường, dấu tiếng Việt, mã dính chữ khác, hai mã, mã của đơn người khác): chỉ đúng một mã hợp lệ mới tự xác nhận — Task 5.
4. **Ghép tay/hoàn tiền chạy cùng lúc với webhook** trên cùng đơn hoặc cùng dòng sổ: không phân bổ hai lần, không hoàn quá số đã nhận, không deadlock thành 500 — Task 9, 10.
5. **Học viên đã gộp tài khoản**: quyền học từ đơn của tài khoản nguồn vẫn hiệu lực khi đăng nhập tài khoản đích; hoàn đơn của tài khoản nguồn thu hồi đúng quyền đó — Task 11.

---

## File Structure

```
prisma/migrations/<ts>_content/migration.sql        # courses, course_versions, lessons, lesson_versions, course_version_lessons
prisma/migrations/<ts>_money/migration.sql          # orders … outbox_events, trigger, grant
prisma/schema.prisma                                # thêm model tương ứng (đọc qua Prisma khi tiện)
src/worker/content-import.ts                        # importContent(client, data) — chỉ dùng pg (CLI)
src/worker/cli.ts                                   # thêm lệnh content:import
src/modules/content/catalog.ts                      # đọc danh mục, bài học thử, sửa giá/trạng thái
src/modules/orders/{codes,orders}.ts                # mã đơn, tạo đơn, hết hạn
src/modules/ledger/{classifier,ingest,manual,queue}.ts
src/modules/ledger/sepay.ts                         # chữ ký + ánh xạ payload SePay [G4]
src/modules/refunds/refunds.ts
src/modules/enrollments/{access,grants,merge}.ts
src/modules/outbox/outbox.ts                        # enqueue(tx, event) — P4 gửi
src/app/api/public/courses/route.ts, src/app/api/public/courses/[slug]/route.ts,
src/app/api/public/courses/[slug]/trial/[position]/route.ts
src/app/api/me/orders/route.ts, src/app/api/me/orders/[code]/route.ts, src/app/api/me/courses/route.ts
src/app/api/payments/sepay/webhook/route.ts
src/app/api/quan-tri/{courses,ledger,orders,refunds,grants,merges}/… (route.ts theo Task)
```

---

### Task 1: Bảng nội dung và lệnh nhập Engine Cadet

**Files:** Create: migration `…_content`, `src/worker/content-import.ts`. Modify: `src/worker/cli.ts`, `tsconfig.json` (`"allowImportingTsExtensions": true`), `prisma/schema.prisma`. Test: `tests/integration/content-import.test.ts`, fixture `tests/fixtures/content-mini.json` (2 khóa, 5 bài, lấy cấu trúc từ tệp thật, bài dùng chung giữa 2 khóa).

**Interfaces:**
- Schema: `courses(id, slug UNIQUE, title_vi, title_en, status CHECK IN ('draft','published','archived') DEFAULT 'draft', price_vnd integer NULL CHECK (price_vnd > 0), current_version_id NULL FK course_versions, created_at, updated_at)` + CHECK `status <> 'published' OR (price_vnd IS NOT NULL AND current_version_id IS NOT NULL)`; `course_versions(id, course_id FK, version int, content_version text, source_hash text, created_at)` UNIQUE `(course_id, version)` và `(course_id, source_hash)`; `lessons(id, external_id UNIQUE, created_at)`; `lesson_versions(id, lesson_id FK, version int, content jsonb, content_hash text, created_at)` UNIQUE `(lesson_id, version)`, `(lesson_id, content_hash)`; `course_version_lessons(course_version_id FK, lesson_version_id FK, position int CHECK ≥ 1, is_free_trial bool)` PK `(course_version_id, position)`, UNIQUE `(course_version_id, lesson_version_id)`. `course_versions`, `lesson_versions`, `course_version_lessons`: trigger chặn UPDATE/DELETE. Quyền `me_app`: SELECT mọi bảng; UPDATE `courses(price_vnd, status, updated_at)` (GRANT theo cột).
- `importContent(client: pg.Client, data: unknown): Promise<{ courses: number; newCourseVersions: number; newLessonVersions: number }>` — một transaction; từ chối (ném `ContentImportError`) khi `publication.importable !== true` hoặc thiếu `courses`/`lessons`. Nội dung một bài = object bài + mảng `activities` của bài (lọc `lesson_id`, sắp theo `order`). `content_hash` = sha256 của JSON chuẩn hóa (khóa sắp xếp). Bài trùng hash → dùng lại phiên bản cũ. Khóa mới → `status='draft'`, `price_vnd NULL`. Phiên bản khóa mới chỉ khi danh sách (bài, hash) theo thứ tự đổi; khi tạo thì đặt `current_version_id`. `is_free_trial = position <= 3`. Không tự publish.
- CLI: `pnpm cli content:import <tệp.json>` (MIGRATOR_DATABASE_URL) in số liệu trả về.

- [ ] **Step 1: Viết test thất bại:** nhập fixture → 2 khóa `draft`, `price_vnd` NULL, mỗi khóa 1 phiên bản, đúng thứ tự `lesson_ids`, 3 vị trí đầu `is_free_trial`; bài dùng chung chỉ một `lesson_versions`; nhập lại y nguyên → `{newCourseVersions: 0, newLessonVersions: 0}`; sửa một bài trong fixture (trong bộ nhớ) rồi nhập → đúng 1 lesson_version mới và phiên bản mới cho **mọi** khóa chứa bài đó, `current_version_id` trỏ phiên bản mới, phiên bản cũ còn nguyên; `importable=false` → ném, DB không đổi; `me_app` UPDATE `course_versions` → lỗi; `me_app` UPDATE `courses.slug` → 42501; publish khi chưa có giá → lỗi CHECK. Thêm một test nhập tệp thật `docs/Engine_Cadet_Three_Levels_v6/Engine_Cadet_Learning_Data_v6.json` → 3 khóa, 94 `lesson_versions`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS; chạy thử `pnpm cli content:import` trên `me_dev`.
- [ ] **Step 5:** commit `feat(content): versioned course content and engine cadet import`.

### Task 2: Danh mục công khai, bài học thử, sửa giá

**Files:** Create: `src/modules/content/catalog.ts`, routes `src/app/api/public/courses/route.ts`, `…/[slug]/route.ts`, `…/[slug]/trial/[position]/route.ts`, `src/app/api/quan-tri/courses/route.ts` (GET), `src/app/api/quan-tri/courses/[id]/route.ts` (PATCH). Test: `tests/integration/catalog.test.ts`.

**Interfaces:**
- `listPublishedCourses(): Promise<CourseCard[]>` với `CourseCard = { slug; titleVi; titleEn; priceVnd: number; lessonCount: number; trialLessons: { position: number; externalId: string; title: string }[] }` (chỉ `published`). Tiêu đề bài: `content.question.vi` nếu có, không thì `content.question.en`, không thì `externalId` (kiểm hình dạng thật của `question` khi cài).
- `getPublishedCourse(slug): Promise<CourseCard & { lessons: { position; externalId; title; isFreeTrial }[] } | null>`.
- `getTrialLesson(slug, position): Promise<{ externalId; content: unknown } | null>` — chỉ khi khóa `published` và dòng của phiên bản hiện hành có `is_free_trial`.
- `updateCourse(ctx: AdminCtx, courseId, change: { priceVnd?: number; status?: 'draft'|'published'|'archived' }): Promise<'ok' | 'not_found' | 'needs_price'>` — `authorize(ctx, 'prices.edit', …)`; một transaction, `SELECT … FOR UPDATE`, audit `course_update` có before/after. Đổi giá không ảnh hưởng đơn đã tạo (ảnh chụp).
- [ ] **Step 1: Viết test thất bại:** khóa `draft` không xuất hiện ở API công khai, bài thử của khóa draft → 404; publish không giá → `needs_price` (409 ở route); owner đặt giá rồi publish → xuất hiện; bài vị trí 3 → 200 có nội dung, vị trí 4 → 404 (không lộ bài trả phí), vị trí `abc`/`0` → 404; support PATCH → 403 `role` + audit; owner lâu chưa xác thực → 403 `reauth_required`; audit ok có before/after giá.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(content): public catalog, free trial lessons, admin pricing`.

### Task 3: Bảng tiền, trigger và quyền DB

**Files:** Create: migration `…_money`. Modify: `prisma/schema.prisma`. Test: `tests/integration/schema-money.test.ts`.

**Interfaces (bảng; mọi FK `ON DELETE RESTRICT`):**
- `orders(id, code UNIQUE CHECK (code ~ '^ME[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'), user_id FK users, status CHECK IN ('pending','paid','expired','refunded') DEFAULT 'pending', amount_due_vnd int CHECK > 0, currency DEFAULT 'VND' CHECK = 'VND', refund_policy_version text NOT NULL, created_at, expires_at CHECK = created_at + interval '15 minutes', paid_at, expired_at, refunded_at)`; CHECK `(paid_at IS NOT NULL) = (status IN ('paid','refunded'))`, `(refunded_at IS NOT NULL) = (status = 'refunded')`. Trigger `BEFORE UPDATE`: cột bất biến (`code, user_id, created_at, expires_at, amount_due_vnd, currency, refund_policy_version`) không đổi; chỉ cho các bước chuyển trong Global Constraints (cùng trạng thái = không phải chuyển, cho phép). Không DELETE.
- `order_items(id, order_id FK, course_id FK, course_version_id FK, list_price_vnd int > 0, final_price_vnd int ≥ 0)`; không UPDATE/DELETE; constraint trigger `DEFERRABLE INITIALLY DEFERRED` trên `orders` INSERT: tổng `final_price_vnd` = `amount_due_vnd`.
- `bank_transactions(id, bank_code CHECK ~ '^[A-Z0-9]{2,20}$', account_no CHECK ~ '^[0-9]{4,30}$', bank_ref CHECK (bank_ref = upper(btrim(bank_ref)) AND bank_ref <> ''), amount_vnd int > 0, currency 'VND', direction CHECK = 'in', content text NOT NULL, bank_time timestamptz NOT NULL, received_at DEFAULT now(), source CHECK IN ('sepay_webhook','sepay_api','manual'), entered_by FK admin_users NULL, evidence text NULL, raw jsonb)`; UNIQUE `(bank_code, account_no, bank_ref)`; CHECK `(source = 'manual') = (entered_by IS NOT NULL AND evidence IS NOT NULL)`; không UPDATE/DELETE.
- `bank_transaction_observations(id, bank_transaction_id NULL FK, source, provider_event_id NULL, payload jsonb, received_at, is_first bool DEFAULT false, mismatch bool DEFAULT false, ignored_reason text NULL, unresolved_reason text NULL CHECK IN ('missing_ref','missing_time'), resolves_observation_id NULL FK self UNIQUE)`; CHECK `bank_transaction_id IS NOT NULL OR ignored_reason IS NOT NULL OR unresolved_reason IS NOT NULL`; UNIQUE một phần `(source, provider_event_id) WHERE provider_event_id IS NOT NULL`; trigger: `resolves_observation_id` chỉ trỏ observation có `unresolved_reason`, và observation giải quyết phải `source='manual'`, có `bank_transaction_id`; chỉ thêm.
- `bank_transaction_verifications(id, bank_transaction_id FK, method CHECK IN ('provider','provider_match','owner'), verified_by FK admin_users NULL, evidence NULL, created_at)`; CHECK `(method = 'owner') = (verified_by IS NOT NULL AND evidence IS NOT NULL)`; trigger: method owner ⇒ `verified_by <> bank_transactions.entered_by`; chỉ thêm.
- `bank_transaction_classifications(id, bank_transaction_id FK, classifier_version text, result CHECK IN ('auto_confirm','queue'), reason text NULL, candidate_codes text[] NOT NULL, candidate_order_id FK orders NULL, created_at)`; CHECK `(result = 'queue') = (reason IS NOT NULL)`; chỉ thêm.
- `payment_allocations(id, bank_transaction_id FK UNIQUE, order_id FK, amount_vnd int > 0, kind CHECK IN ('auto','manual'), allocated_by FK admin_users NULL, created_at)`; CHECK `(kind='manual') = (allocated_by IS NOT NULL)`; không UPDATE/DELETE; constraint trigger hoãn: không có disposition hiệu lực cho cùng dòng sổ; `amount_vnd` = `bank_transactions.amount_vnd`.
- `bank_transaction_dispositions(id, bank_transaction_id FK, kind CHECK IN ('duplicate','ignored'), reason NOT NULL, decided_by FK admin_users NOT NULL, created_at, superseded_at NULL)`; UNIQUE một phần `(bank_transaction_id) WHERE superseded_at IS NULL`; constraint trigger hoãn: không có phân bổ; chỉ được UPDATE cột `superseded_at` (từ NULL).
- `refunds(id, order_id FK, kind CHECK IN ('full','excess'), amount_vnd int > 0, status CHECK IN ('requested','approved','sent','confirmed','failed','cancelled') DEFAULT 'requested', reason NOT NULL, out_bank_ref UNIQUE NULL, evidence NULL, requested_by/approved_by/sent_by/confirmed_by FK admin_users NULL, requested_at DEFAULT now(), approved_at, sent_at, confirmed_at, closed_at)`; CHECK `status NOT IN ('sent','confirmed') OR out_bank_ref IS NOT NULL`; UNIQUE một phần `(order_id) WHERE kind='full' AND status NOT IN ('failed','cancelled')`; trigger chuyển trạng thái: `requested→approved|cancelled`, `approved→sent|cancelled`, `sent→confirmed|failed`; cột `order_id, kind, amount_vnd` bất biến; không DELETE.
- `refund_sources(refund_id FK, bank_transaction_id FK, amount_vnd int > 0)` PK cặp; không UPDATE/DELETE; constraint trigger hoãn (AFTER INSERT trên `refund_sources` và AFTER INSERT/UPDATE trên `refunds`): dòng sổ phải được phân bổ cho đơn của refund; tổng nguồn = `refunds.amount_vnd`; theo dòng sổ, tổng nguồn của refund chưa failed/cancelled ≤ `amount_vnd` dòng sổ; `full` có `amount_vnd = orders.amount_due_vnd`; tổng `excess` chưa failed/cancelled của đơn ≤ (tổng phân bổ của đơn − `amount_due_vnd`).
- `enrollments(id, user_id FK, course_id FK, source CHECK IN ('order','grant'), order_id FK NULL, grant_reason NULL, granted_by FK admin_users NULL, created_at, revoked_at NULL, revoked_reason NULL)`; CHECK `(source='order') = (order_id IS NOT NULL AND grant_reason IS NULL AND granted_by IS NULL)`, `(source='grant') = (order_id IS NULL AND grant_reason IS NOT NULL AND granted_by IS NOT NULL)`, `(revoked_at IS NULL) = (revoked_reason IS NULL)`; UNIQUE `(order_id, course_id)`; chỉ được UPDATE `revoked_at`/`revoked_reason` từ NULL.
- `outbox_events(id, dedup_key UNIQUE, kind text, channel CHECK IN ('email','telegram'), payload jsonb, status CHECK IN ('pending','sending','sent','failed','dead') DEFAULT 'pending', attempts int DEFAULT 0, next_attempt_at DEFAULT now(), last_error NULL, created_at, sent_at NULL)`.
- Quyền `me_app`: SELECT + INSERT mọi bảng trên; UPDATE `orders`, `refunds`, `enrollments`, `bank_transaction_dispositions`, `outbox_events`; không DELETE.
- [ ] **Step 1: Viết test thất bại** (bằng `me_app`, theo kiểu `schema-auth.test.ts`): sửa `orders.amount_due_vnd` → lỗi; `paid→pending`, `refunded→paid`, `pending→refunded` → lỗi; `expired→paid` được; đơn có tổng item khác `amount_due_vnd` → lỗi khi commit; `order_items` UPDATE/DELETE → lỗi; `bank_transactions` trùng `(bank_code, account_no, bank_ref)` → 23505, UPDATE → lỗi, `bank_ref` chữ thường → CHECK; verification owner với `verified_by = entered_by` → lỗi; phân bổ thứ hai cùng dòng sổ → 23505; phân bổ khi đã có disposition hiệu lực → lỗi khi commit (và ngược lại); refund `requested→sent` → lỗi; `sent` không `out_bank_ref` → CHECK; hai refund `full` hiệu lực cùng đơn → 23505; refund_sources vượt số tiền dòng sổ / dòng sổ không phân bổ cho đơn đó / full khác `amount_due_vnd` → lỗi khi commit; enrollment `source='order'` không `order_id` → CHECK; `me_app` DELETE bất kỳ bảng mới → 42501.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(money): ledger, orders, refunds and enrollments schema with db guards`.

### Task 4: Tạo đơn, mã đơn, hết hạn

**Files:** Create: `src/modules/orders/codes.ts`, `src/modules/orders/orders.ts`, `src/modules/outbox/outbox.ts`, routes `src/app/api/me/orders/route.ts` (POST), `src/app/api/me/orders/[code]/route.ts` (GET). Test: `tests/unit/order-codes.test.ts`, `tests/integration/orders.test.ts`.

**Interfaces:**
- `ORDER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`; `newOrderCode(): string`; `REFUND_POLICY_VERSION = 'de-xuat-2026-10'` [G13].
- `createOrder(ctx: LearnerCtx, courseSlug: string): Promise<{ kind: 'created' | 'existing'; order: OrderView } | { kind: 'not_for_sale' | 'already_enrolled' }>` với `OrderView = { code; status; amountDueVnd; expiresAt: Date; courseSlug; courseTitleVi }`. Một transaction: khóa `users` (FOR UPDATE, nhóm gộp đã thuộc Task 11 — ở đây dùng `hasCourseAccess` từ Task 11 nếu đã có, nếu chưa thì kiểm `enrollments` của chính user; Task 11 thay bằng nhóm gộp) → khóa `published` mới bán → đã có quyền → `already_enrolled` → có đơn `pending` chưa hết hạn cùng khóa → trả `existing` → không thì tạo đơn (giá = `courses.price_vnd`, `course_version_id` hiện hành) + `order_items`; thử lại mã khi 23505 trên `orders_code_key` (savepoint), tối đa 5.
- `getOrderForLearner(ctx, code): Promise<OrderView | null>` (chỉ đơn thuộc nhóm gộp của học viên; Task 11 mở rộng).
- `expireOrders(): Promise<number>` — `UPDATE orders SET status='expired', expired_at=now() WHERE status='pending' AND expires_at <= now()`; P4 gọi mỗi phút.
- `enqueueOutbox(tx: Tx, event: { dedupKey: string; kind: string; channel: 'email'|'telegram'; payload: Record<string, unknown> }): Promise<void>` — `ON CONFLICT (dedup_key) DO NOTHING`.
- POST `/api/me/orders` `{ courseSlug }` → 201 `created` / 200 `existing` / 409 `{ error: 'not_for_sale' | 'already_enrolled' }`; body từ client không có giá. GET `/api/me/orders/[code]` → 200 `OrderView` hoặc 404.
- [ ] **Step 1: Viết test thất bại:** unit: 10 000 mã khớp regex, không chứa `0 O 1 I L`; integration: đơn có `amount_due_vnd` = giá khóa dù body gửi kèm `amountVnd: 1`; đổi giá sau khi tạo → đơn cũ giữ giá; khóa draft → 409; gọi tạo hai lần → cùng một mã (`existing`); hai lời gọi song song → một đơn; giả lập trùng mã (stub `newOrderCode` qua tham số tùy chọn `codeSource`) → thử lại thành công, 6 lần trùng → `OrderCodeExhaustedError`; `expireOrders` ở `expires_at − 1s` không đổi, ở `expires_at` → `expired` có `expired_at`; GET đơn của người khác → 404; phiên quản trị gọi → 401.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(orders): server-priced orders with random codes and expiry`.

### Task 5: Bộ phân loại giao dịch (thuần)

**Files:** Create: `src/modules/ledger/classifier.ts`. Test: `tests/unit/classifier.test.ts`.

**Interfaces:**
- `CLASSIFIER_VERSION = 'v1'`; `extractOrderCodes(content: string): string[]` — chữ hoa, bỏ dấu (NFD + bỏ ký tự kết hợp, `Đ→D`), ký tự ngoài `A–Z0–9` thành khoảng trắng; tìm mọi chuỗi `ME` + 8 ký tự bảng mã **đứng riêng** (ranh giới là đầu/cuối chuỗi hoặc khoảng trắng) và cả trường hợp dính liền tiền tố/hậu tố chữ số của ngân hàng: dùng regex `/(?<![A-Z0-9])ME[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}(?![A-Z0-9])/g` trên chuỗi đã chuẩn hóa; trả mảng không trùng, theo thứ tự xuất hiện.
- `classify(input: { amountVnd: number; bankTime: Date; now: Date; codes: string[]; order: { id: string; status: OrderStatus; amountDueVnd: number; createdAt: Date; expiresAt: Date } | null }): { result: 'auto_confirm' } | { result: 'queue'; reason: QueueReason }` với `QueueReason = 'no_code' | 'multi_code' | 'unknown_code' | 'amount_short' | 'amount_over' | 'late' | 'early' | 'order_paid' | 'order_refunded' | 'bad_time'`. Thứ tự kiểm: `bad_time` (bankTime > now + 5 phút) → số mã (0 → `no_code`, >1 → `multi_code`) → `order` null → `unknown_code` → status paid/refunded → `order_paid`/`order_refunded` → `bankTime < createdAt` → `early` → `bankTime >= expiresAt` → `late` → thiếu/thừa tiền → `auto_confirm`.
- [ ] **Step 1: Viết test thất bại** (`it.each`): `'ME7K3QX9AB'` (dính chữ) → `[]`; `'ck me7k3qx9 cam on'` → `['ME7K3QX9']`; `'Chuyển tiền ME7K3QX9.'` → 1 mã; `'ME7K3QX9 ME7K3QX9'` → 1 mã; hai mã khác nhau → 2; mã chứa `O` → `[]`; `'MBVCB.123.ME7K3QX9.CT'` → 1 mã; bảng `classify`: đúng tiền trong hạn `pending` → auto; `expired` + bankTime trong hạn → auto; bankTime = expiresAt → `late`; = createdAt → auto; createdAt − 1s → `early`; +5 phút + 1s tương lai → `bad_time`; thiếu 1 đồng → `amount_short`; thừa → `amount_over`; đơn paid → `order_paid`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ledger): pure transfer classifier`.

### Task 6: `ingest()` — ghi sổ, xác minh, tự xác nhận

**Files:** Create: `src/modules/ledger/ingest.ts`, `src/modules/enrollments/enroll.ts`. Test: `tests/integration/ingest.test.ts`.

**Interfaces:**
- `type BankReport = { source: 'sepay_webhook' | 'sepay_api' | 'manual'; providerEventId?: string; bankCode: string; accountNo: string; bankRef: string | null; amountVnd: number; direction: 'in' | 'out'; currency: string; content: string; bankTime: Date | null; raw: unknown; enteredBy?: string; evidence?: string }`.
- `ingest(report: BankReport, opts?: { deadlineAt?: number; lockTimeoutMs?: number; statementTimeoutMs?: number }): Promise<IngestOutcome>` với `IngestOutcome = 'ignored' | 'unresolved' | 'duplicate_event' | 'mismatch' | 'unverified' | 'already_settled' | 'queued' | 'confirmed'` — chạy `withTx` theo §4.3: (0) `direction≠'in'`, `currency≠'VND'`, tài khoản ≠ `SEPAY_BANK_CODE/SEPAY_ACCOUNT_NO` (với nguồn SePay) → observation `ignored_reason`; (1) chuẩn hóa `bankRef` (trim, chữ hoa); thiếu ref/time → observation `unresolved_reason`; (2) `INSERT … ON CONFLICT DO NOTHING RETURNING id`, rồi `SELECT … FOR UPDATE`; (3) observation liên kết (`is_first`); trùng `(source, provider_event_id)` → `duplicate_event` (bắt 23505 bằng savepoint, không lỗi); (4/5) xác minh `provider` cho dòng mới từ SePay; dòng cũ: so chính xác `amount_vnd`, `bank_time` → lệch: observation `mismatch=true` + outbox `ledger_mismatch` (telegram) → `mismatch`; khớp và nguồn SePay → verification `provider_match` nếu chưa có; (6) chưa xác minh → `unverified`; (7) đã có phân bổ/kết luận → `already_settled`; (8) `extractOrderCodes` → tìm đơn theo mã (một mã) `FOR UPDATE` → `classify` (`now` = DB `now()`) → ghi classification; (9) auto → `settleOrder(tx, …)`; queue → outbox `ledger_queued` (telegram, dedup `queued:<tx id>`) → `queued`.
- `settleOrder(tx, input: { orderId: string; bankTransactionIds: string[]; kind: 'auto'|'manual'; allocatedBy?: string }): Promise<void>` (dùng lại ở Task 9): phân bổ từng dòng (toàn bộ số tiền), đơn → `paid` + `paid_at`, `enrollments` source order cho mỗi `order_items.course_id` (`ON CONFLICT (order_id, course_id) DO NOTHING`), outbox `order_paid` (telegram + email, dedup `order_paid:<order id>:<channel>`).
- `ingestStepFromVerification(tx, bankTransactionId): Promise<IngestOutcome>` — bước 7–9 cho dòng vừa được chủ xác minh (Task 8 gọi trong transaction của mình).
- [ ] **Step 1: Viết test thất bại:** báo cáo SePay đúng → `confirmed`, đơn `paid`, 1 phân bổ, 1 enrollment, outbox có `order_paid` telegram + email; gửi lại y nguyên 3 lần → `already_settled`, vẫn 1 phân bổ/enrollment/outbox mỗi kênh, mỗi lần thêm 1 observation; 5 lời gọi song song cùng giao dịch → 1 dòng sổ, 1 phân bổ; đơn đã bị `expireOrders` + bankTime trong hạn → `confirmed`; bankTime sau hạn → `queued` reason `late`, đơn `expired`; tiền ra / VND khác / tài khoản khác → `ignored`, không dòng sổ; thiếu `bankRef` → `unresolved`; nguồn manual → `unverified`, không classification; SePay báo sau dòng manual cùng định danh, khớp → verification `provider_match` rồi `confirmed`; lệch số tiền → `mismatch`, không xác minh, outbox `ledger_mismatch`; giao dịch thứ hai cho đơn đã paid → `queued` `order_paid`, đơn vẫn `paid`; một đơn nhận hai giao dịch song song đúng tiền → đúng một `confirmed`, cái kia `queued` `order_paid`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ledger): single ingest path with auto-confirmation`.

### Task 7: Webhook SePay

**Files:** Create: `src/modules/ledger/sepay.ts`, `src/app/api/payments/sepay/webhook/route.ts`. Modify: `src/lib/env.ts` (thêm `SEPAY_WEBHOOK_SECRETS` dạng `id:bí-mật,…` tùy chọn, `SEPAY_BANK_CODE`, `SEPAY_ACCOUNT_NO` tùy chọn), `tests/helpers/test-env.ts`. Test: `tests/integration/sepay-webhook.test.ts`.

**Interfaces:**
- `signaturePayload(timestamp: string, rawBody: string): string` = `` `${timestamp}.${rawBody}` ``; `verifySepaySignature(headers: Headers, rawBody: string, nowMs: number): 'ok' | 'missing' | 'bad_signature' | 'stale'` — header `X-SePay-Signature` (hex HMAC-SHA256), `X-SePay-Timestamp` (giây Unix), lệch ≤ 300 s; thử mọi bí mật. Toàn bộ quy ước chuỗi ký nằm trong hàm này để sửa một chỗ khi G4 có tài liệu. [G4]
- `toBankReport(payload: unknown): BankReport | null` — đọc payload SePay: `id` → `providerEventId`, `gateway` → `bankCode` (chữ hoa), `accountNumber`, `referenceCode` → `bankRef`, `transferType` (`'in'|'out'`), `transferAmount`, `content`, `transactionDate` (`'YYYY-MM-DD HH:mm:ss'` giờ Việt Nam → UTC); sai kiểu → null. [G4: xác nhận tên trường]
- Route: không cấu hình bí mật → 503; Content-Type khác JSON → 415; body > 65 536 byte → 413; chữ ký → 401 (log an ninh không kèm body/chữ ký); body hỏng → 400; `ingest` với `deadlineAt = start + 8000`, `lockTimeoutMs: 2000`, `statementTimeoutMs: 3000`, thử lại chỉ khi còn ≥ 3500 ms (truyền qua `withTx`), lỗi tạm thời/hết hạn → 503; còn lại 200 `{ success: true }`.
- [ ] **Step 1: Viết test thất bại:** chữ ký đúng (khóa hiện tại và khóa cũ) → 200 + `confirmed`; sửa 1 byte body sau khi ký → 401; timestamp lệch 301 s → 401, 299 s → 200; thiếu header → 401; JSON hỏng có chữ ký đúng → 400; 70 KB → 413; `text/plain` → 415; replay cùng request 3 lần → một phân bổ; hai request song song → một phân bổ; không cấu hình bí mật → 503; log không chứa `content` của giao dịch (bắt `console`).
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(payments): signed sepay webhook into the ledger`.

### Task 8: Nhập sao kê, chủ xác minh, hàng chờ

**Files:** Create: `src/modules/ledger/manual.ts`, `src/modules/ledger/queue.ts`, routes `src/app/api/quan-tri/ledger/route.ts` (GET hàng chờ, POST nhập sao kê), `src/app/api/quan-tri/ledger/[id]/verify/route.ts` (POST). Modify: `src/modules/auth-admin/authorize.ts` nếu cần thêm quyền `ledger.enter` (support + owner) và `ledger.verify` (owner, recentAuth). Test: `tests/integration/ledger-manual.test.ts`.

**Interfaces:**
- `enterStatementLine(ctx: AdminCtx, input: { bankCode; accountNo; bankRef; amountVnd; bankTime: Date; content: string; evidence: string; resolvesObservationId?: string }): Promise<IngestOutcome>` — `authorize('ledger.enter')`; gọi `ingest` nguồn `manual` (`enteredBy = ctx.adminId`); audit `ledger_enter`.
- `verifyStatementLine(ctx, bankTransactionId, evidence: string): Promise<'verified' | 'already_verified' | 'self_entered' | 'not_found'> & outcome` — trả `{ result; outcome?: IngestOutcome }`; `authorize('ledger.verify')`; một transaction: khóa dòng sổ → `entered_by = ctx.adminId` → `self_entered` (audit denied) → ghi verification owner → `ingestStepFromVerification` → audit.
- `listQueue(): Promise<QueueRow[]>` với `QueueRow = { bankTransactionId; bankTime; amountVnd; content; reason: QueueReason | 'unverified'; candidateCodes: string[]; candidateOrderCode: string | null }` (dòng sổ không phân bổ, không kết luận hiệu lực, kèm lần phân loại gần nhất; dòng chưa xác minh với reason `unverified`), và `listUnresolved(): Promise<…>` (observation `unresolved_reason` chưa được giải quyết). `orderNeedsManual(orderId): Promise<boolean>`.
- [ ] **Step 1: Viết test thất bại:** support nhập sao kê → `unverified`, hiện trong hàng chờ `unverified`; chính người nhập (owner) xác minh → `self_entered` + audit denied; owner khác xác minh → giao dịch đúng mã đúng tiền → đơn `paid`; support xác minh → 403 `role`; nhập trùng định danh dòng đã có từ webhook với số tiền khác → `mismatch`; hàng chờ chứa giao dịch không mã và giao dịch `late`, không chứa dòng đã phân bổ; `orderNeedsManual` true cho đơn có giao dịch thiếu tiền; giải quyết observation `missing_ref` bằng dòng nhập tay → `resolves_observation_id` được ghi, observation đó rời `listUnresolved`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ledger): statement entry, owner verification, manual queue`.

### Task 9: Ghép tay, kết luận, cấp không thu tiền

**Files:** Create: `src/modules/ledger/match.ts`, `src/modules/enrollments/grants.ts`, routes `src/app/api/quan-tri/ledger/match/route.ts`, `src/app/api/quan-tri/ledger/[id]/disposition/route.ts`, `src/app/api/quan-tri/grants/route.ts`. Test: `tests/integration/ledger-match.test.ts`, `tests/integration/grants.test.ts`.

**Interfaces:**
- `matchTransfers(ctx, input: { orderCode: string; bankTransactionIds: string[]; note: string; evidence: string }): Promise<{ result: 'paid' | 'paid_with_excess_refund' | 'short' } | { result: 'rejected'; reason: 'not_verified' | 'already_settled' | 'order_refunded' | 'order_paid' | 'not_found' }>` — một transaction: khóa dòng sổ theo id tăng dần → khóa đơn → kiểm → tổng = phải trả → `settleOrder(kind 'manual')`; tổng > phải trả → `settleOrder` + refund `excess` (`requested`, số = tổng − phải trả, nguồn: dòng `bank_time` muộn nhất trước) ; tổng < phải trả → không đổi gì, `short` (audit ok ghi số thiếu). Quyền: 1 dòng sổ → `payments.match` (support được); ≥ 2 dòng → owner (`authorize` với điều kiện thêm: nếu `bankTransactionIds.length > 1` và `ctx.role !== 'owner'` → `auditDenied` + 403 `role`). Audit `ledger_match` có trước/sau, chênh lệch, bằng chứng.
- `setDisposition(ctx, bankTransactionId, input: { kind: 'duplicate' | 'ignored'; reason: string }): Promise<'ok' | 'already_settled'>` — owner (`payments.match` + kiểm role owner như trên); disposition cũ (nếu có) `superseded_at = now()` rồi chèn mới; audit.
- `grantCourse(ctx, input: { userId; courseId; reason: string }): Promise<'granted' | 'not_found'>` — `authorize('grants.create')` (owner, recentAuth); `enrollments` source grant; không đụng `orders`; audit `grant_create`. `revokeGrant(ctx, enrollmentId, reason)` cùng quyền.
- [ ] **Step 1: Viết test thất bại:** support ghép 1 dòng đúng tiền, nội dung không mã → `paid`, phân bổ `manual` có `allocated_by`; dùng lại dòng đó cho đơn khác → `already_settled`; dòng chưa xác minh → `not_verified`; support ghép 2 dòng → 403; owner ghép 2 dòng tổng đủ → `paid`, 2 phân bổ; thiếu → `short`, đơn không đổi; thừa → `paid_with_excess_refund`, refund excess đúng số, nguồn là dòng muộn nhất; ghép đúng lúc webhook xác nhận cùng đơn (song song) → một bên `order_paid`/`already_settled`, không 500; disposition `ignored` rồi ghép → `already_settled`; grant → enrollment source grant, đơn không đổi, audit; grant thiếu lý do → 400; support grant → 403.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ledger): manual matching, dispositions and non-payment grants`.

### Task 10: Hoàn tiền

**Files:** Create: `src/modules/refunds/refunds.ts`, routes `src/app/api/quan-tri/refunds/route.ts` (GET, POST đề nghị), `src/app/api/quan-tri/refunds/[id]/route.ts` (POST `{ action: 'approve' | 'send' | 'confirm' | 'fail' | 'cancel', outBankRef?, evidence? }`). Test: `tests/integration/refunds.test.ts`.

**Interfaces:**
- `requestFullRefund(ctx, input: { orderCode; reason }): Promise<{ refundId: string } | { rejected: 'not_paid' | 'active_full_refund' }>` — `authorize('refunds.request')`; khóa dòng sổ đã phân bổ cho đơn (id tăng dần) → đơn; nguồn = các dòng đã phân bổ, lấy dòng muộn nhất trước tới đủ `amount_due_vnd`.
- `advanceRefund(ctx, refundId, step: { action: 'approve' } | { action: 'send'; outBankRef: string; evidence: string } | { action: 'confirm' } | { action: 'fail'; reason: string } | { action: 'cancel'; reason: string }): Promise<'ok' | 'invalid_transition'>` — approve/confirm/fail/cancel: `refunds.approve` (owner, recentAuth); send: owner. Khóa: dòng sổ nguồn → đơn → refund. `confirm` với `full`: đơn → `refunded` + `refunded_at`, thu hồi mọi enrollment `order_id = đơn` (`revoked_reason = 'refund:<id>'`), outbox `order_refunded`; `excess`: chỉ refund. Mọi bước audit.
- [ ] **Step 1: Viết test thất bại:** đơn paid → đề nghị → duyệt → chuyển (out_bank_ref) → xác nhận → đơn `refunded`, enrollment bị thu hồi, quyền học mất; refund excess xác nhận → đơn vẫn `paid`, quyền còn; đề nghị full lần hai khi lần một chưa đóng → `active_full_refund`; `confirm` khi đang `requested` → `invalid_transition`; trùng `out_bank_ref` → lỗi rõ ràng (409); support duyệt → 403; xác nhận hoàn song song với ghép tay một dòng sổ mới vào cùng đơn → không deadlock, kết quả nhất quán (đơn `refunded`, dòng mới vào hàng chờ `order_refunded` hoặc bị từ chối); refund excess vượt phần thừa → lỗi khi commit.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(refunds): manual refund lifecycle with enrollment revocation`.

### Task 11: Quyền học theo nhóm gộp, gộp tài khoản

**Files:** Create: `src/modules/enrollments/access.ts`, `src/modules/enrollments/merge.ts`, routes `src/app/api/me/courses/route.ts` (GET), `src/app/api/quan-tri/merges/route.ts` (POST `{ sourceUserId, targetUserId, reason, preview?: boolean }`). Modify: `src/modules/orders/orders.ts` (dùng nhóm gộp). Test: `tests/integration/access-merge.test.ts`.

**Interfaces:**
- `mergeGroupIds(tx: Tx | null, userId: string): Promise<string[]>` — đệ quy: user + mọi user có `merged_into_id` dẫn tới user (đệ quy CTE).
- `hasCourseAccess(userId, courseId): Promise<boolean>`; `listMyCourses(ctx: LearnerCtx): Promise<{ slug; titleVi; sources: ('order'|'grant')[] }[]>`.
- `mergeAccounts(ctx: AdminCtx, input: { sourceUserId; targetUserId; reason: string; preview: boolean }): Promise<MergePreview | 'merged' | 'invalid'>` với `MergePreview = { identities: { kind; value }[]; activeEnrollments: number; orders: number }` — `authorize('accounts.merge')`; khóa hai `users` theo id tăng dần; cả hai `active`, khác nhau, đích không nằm trong nhóm nguồn; chuyển `user_identities` sang đích; nguồn `status='merged'`, `merged_into_id`; thu hồi mọi phiên (`revokeAllForSubject`) và thiết bị của nguồn; không đụng đơn/enrollment/refund; audit `account_merge` có danh sách định danh. (Tiến độ học: P3.)
- [ ] **Step 1: Viết test thất bại:** A mua khóa X, gộp A vào B → B có quyền X qua `hasCourseAccess(B, X)`; đăng nhập bằng email cũ của A → vào B; phiên cũ của A null; hoàn đơn của A → B mất quyền X; B tạo đơn khóa X khi đã có quyền qua A → `already_enrolled`; gộp vòng (B vào A sau khi A vào B) → `invalid`; `preview` không đổi gì; support gộp → 403; GET `/api/me/courses` liệt kê nguồn.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(enrollments): merge-group access and admin account merge`.

### Task 12: Kiểm tra toàn bộ, tài liệu

- [ ] **Step 1:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → không lỗi.
- [ ] **Step 2:** Cập nhật `CLAUDE.md` (lệnh `content:import`, biến `SEPAY_*`), `docs/session-handoff.md` (trạng thái P2, việc chờ cổng G4/G5/G13/G14), `PROGRESS.md`.
- [ ] **Step 3:** commit `docs: record p2 status`.

---

## Không nằm trong P2

Mã giảm giá và combo (G14); điều chỉnh sau hoàn (`refund_adjustments`, G13); chính sách hoàn tự động (G13); đối soát API SePay và con trỏ (P4, G4); gửi outbox email/Telegram (P4); job hết hạn đơn chạy định kỳ (P4 gọi `expireOrders`); media, manifest, tải tệp, tiến độ học, chép tiến độ khi gộp (P3); giao diện checkout/quản trị đầy đủ (P5).
