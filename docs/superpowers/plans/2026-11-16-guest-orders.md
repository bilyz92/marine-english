# Đơn của khách chưa có tài khoản: tạo tài khoản khi đã nhận tiền — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách chưa đăng nhập điền tên, số điện thoại, email → hệ thống chỉ tạo **đơn** (chưa có tài khoản). Khi đơn được thanh toán (SePay tự xác nhận, hoặc quản trị ghép tay), trong cùng transaction đó hệ thống tạo tài khoản theo thông tin đã điền, mở khóa học và gửi thông tin đăng nhập vào email.

**Architecture:** Bảng mới `guest_orders` (1–1 với `orders`) giữ thông tin người mua, mật khẩu tạm đã băm sẵn (băm lúc tạo đơn, không băm trong transaction nhận tiền) và bản mã hóa của mật khẩu đó, cùng băm của mã truy cập trang đơn (cookie). `orders.user_id` cho phép null khi đơn chưa trả tiền. `settleOrder` (đường duy nhất làm đơn thành "paid") gọi `createAccountForGuestOrder` trước khi cấp quyền học; email "đơn đã thanh toán" đã có sẵn cơ chế ghép mật khẩu tạm lúc gửi (`withLoginInfo` trong `src/modules/outbox/deliver.ts`).

**Tech Stack:** Next.js 16 App Router, Prisma 7 raw SQL, PostgreSQL 16, Vitest (unit + integration trên Postgres thật), headless Chrome e2e.

**Spec:** quyết định của chủ trong chat 16/11/2026: (1) email bắt buộc; (2) thông tin tài khoản chỉ gửi qua email (không hiện ở bước 3); (3) số điện thoại hoặc email đã có tài khoản → báo trùng, mời đăng nhập; (4) thông tin khách của đơn không trả tiền vẫn giữ (không tự xóa). Bất biến thanh toán trong `CLAUDE.md` (mục Payment flow invariants) và `docs/design-gates-2026-10-30.md` §2 vẫn giữ nguyên.

## Global Constraints

- Giá luôn lấy từ `courses` trên máy chủ; client chỉ gửi `courseSlug`.
- Đơn chỉ thành "paid" qua `settleOrder` từ giao dịch đã xác minh; tạo tài khoản, phân bổ, cấp quyền, outbox nằm **trong cùng một transaction**; thông báo lỗi không được làm hỏng việc mở khóa.
- Mật khẩu không bao giờ nằm trong outbox, log, hay phản hồi API; chỉ băm (`hashPassword`) và bản niêm phong AES-GCM (`SESSION_ENC_KEYS`).
- Thứ tự khóa (password.ts, mở rộng): `users` → khóa tư vấn IP → khóa tư vấn số `phone:<số>` → **khóa tư vấn email `email:<email chuẩn hóa>` (mới)** → `password_logins`. Mọi đường của plan này (tạo đơn khách, kiểm trùng và tạo tài khoản khi nhận tiền) lấy khóa số rồi khóa email theo đúng thứ tự đó. Transaction nhận tiền đã khóa dòng sổ rồi đơn; sau đó chỉ lấy thêm khóa số và khóa email (các đường khác không giữ khóa sổ/đơn khi lấy hai khóa này, nên không có vòng chờ). **Mọi chỗ ghi `user_identities` kiểu email hoặc phone** (`src/modules/auth-learner/identities.ts:20`, `google-login.ts:20,29`, `link.ts:46`) gọi `lockIdentityValue(tx, kind, value)` (mới, trong `password.ts`, dùng chung `lockKeys`) **trước** khi chèn, nên kiểm trùng của đơn khách và việc gắn email/số đã xác minh không chạy xen nhau.
- **Đường duy nhất tới "paid" là `settleOrder`**, và chính nó kiểm `guestConflict`: trùng thì ném `GuestConflictError` (rollback). Người gọi nào muốn kết quả khác (vào hàng chờ, từ chối) phải kiểm trước, nhưng không người gọi nào lách được.
- **Chỉ mở bán cho khách khi email gửi được** (`emailReady()` trong `src/modules/mail/email-sender.ts`): chưa có SMTP thì trang mua không hiện form khách và `POST /api/public/orders` trả 503 `email_unavailable`; khách được mời tạo tài khoản (`/dang-ky`) hoặc đăng nhập rồi mua như hiện nay.
- Viết migration bằng tay (không `prisma migrate dev`), cập nhật `prisma/schema.prisma` cho khớp.
- Chữ trên giao diện: tiếng Việt, ≥ 15px, theo `src/app/tokens.css`.
- Người đã đăng nhập mua khóa: giữ nguyên luồng hiện tại (`POST /api/me/orders`).

## Review Focus

1. Hai đơn khách cùng số/email cùng được trả tiền (đơn hết hạn vẫn được trả trong cửa sổ) → đơn sau không được tạo tài khoản thứ hai hay gắn nhầm; tiền vào hàng chờ "cần xử lý tay" lý do `guest_conflict`. Test: Task 3 `second paid guest order with same phone is queued as guest_conflict`.
2. Người khác đoán mã đơn → không xem được trang đơn (cần cookie mã truy cập đúng). Test: Task 4 `guest checkout requires the access cookie`.
3. Webhook gửi lại hai lần → chỉ một tài khoản, một email. Test: Task 3 `replayed webhook creates one account`.
4. Email gõ sai → không có đường lộ mật khẩu ra trang web; ô "Nhập lại email" phải khớp. Test: Task 4 `email_mismatch` và Task 5 e2e.
5. Một IP tạo đơn khách liên tục → giới hạn 10 đơn khách mỗi giờ mỗi IP. Test: Task 2 `throttles the 11th guest order from one IP in an hour`.
6. Hai yêu cầu cùng email, khác số và khác IP, chạy song song (tạo đơn và nhận tiền) → chỉ một thành công. Test: Task 2 `concurrent guest orders with the same email: one wins`, Task 3 `concurrent settlement of two guest orders with the same email creates one account`.
7. Máy chủ chưa có SMTP → không nhận tiền của khách chưa có tài khoản. Test: Task 4 `guest checkout is refused when email is not ready`.

---

### Task 1: Migration và schema

**Files:**
- Create: `prisma/migrations/20261116090000_guest_orders/migration.sql`
- Modify: `prisma/schema.prisma` (model Order: `userId String?`; OrderTermsAcceptance: `userId String?`; model GuestOrder mới)
- Test: `tests/integration/guest-orders-schema.test.ts`

Migration:
- `ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL; ADD CONSTRAINT orders_user_when_paid CHECK (user_id IS NOT NULL OR status IN ('pending','expired'))`.
- `ALTER TABLE order_terms_acceptances ALTER COLUMN user_id DROP NOT NULL`.
- `CREATE TABLE guest_orders (order_id uuid PK REFERENCES orders ON DELETE RESTRICT, display_name text NOT NULL CHECK (length 1..100), phone_canonical text NOT NULL CHECK (~ '^\+84[0-9]{9}$'), email text NOT NULL CHECK (email <> ''), password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'), password_enc text NULL, access_token_hash text NOT NULL UNIQUE, created_ip inet NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), user_id uuid NULL REFERENCES users ON DELETE RESTRICT)`; index trên `phone_canonical`, `email`.
- Mỗi đơn có đúng một trong hai lúc tạo: `orders.user_id` hoặc dòng `guest_orders` — `CREATE CONSTRAINT TRIGGER ... AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED`: `user_id IS NOT NULL OR EXISTS guest_orders`.
- Viết lại `orders_guard` bằng `IS DISTINCT FROM` cho mọi cột bất biến (hiện dùng `<>`, NULL lọt qua). `user_id` chỉ được đổi theo đúng một kiểu: `OLD.user_id IS NULL AND NEW.user_id IS NOT NULL AND NEW.user_id = (SELECT user_id FROM guest_orders WHERE order_id = NEW.id)`; mọi thay đổi khác (đặt về NULL, đổi sang người khác, gán lại) → `order_immutable`.
- `guest_orders_guard` (BEFORE UPDATE OR DELETE): DELETE bị cấm; các cột thông tin và `password_hash`, `access_token_hash`, `created_*` bất biến; `user_id` chỉ NULL → giá trị một lần; `password_enc` chỉ được đổi thành NULL.
- `password_attempts_kind_check` thêm `'guest_order'`.
- `GRANT SELECT, INSERT ON guest_orders TO me_app; GRANT UPDATE (user_id, password_enc) ON guest_orders TO me_app`.

- [ ] **Step 1: Test hỏng trước**: `paid order without user is rejected` (UPDATE đơn khách sang paid khi `user_id` null → lỗi ràng buộc), `order without user and without guest row is rejected at commit`, `guest_order attempt kind is accepted`, `orders_guard: normal order user cannot be set to NULL or changed`, `orders_guard: guest order user must match guest_orders.user_id and is set once`, `guest_orders: identity fields immutable, password_enc only cleared, user_id set once, no delete`.
- [ ] **Step 2:** `pnpm vitest run --project integration tests/integration/guest-orders-schema.test.ts` → FAIL.
- [ ] **Step 3:** Viết migration + schema.prisma.
- [ ] **Step 4:** Chạy lại → PASS; `pnpm typecheck` sạch.

### Task 2: Tạo đơn khách

**Files:**
- Create: `src/modules/orders/guest.ts`
- Modify: `src/modules/auth-learner/password.ts` (export `phoneTaken`, thêm và export `emailInUse(tx, email)`: có trong `user_identities` kind email **hoặc** `learner_contact_emails`), `src/modules/orders/orders.ts` (tách phần chèn đơn + `order_items` thành `insertOrder(tx, { userId: string | null, course, codeSource })` dùng chung)
- Test: `tests/integration/guest-orders.test.ts`

**Interfaces — Produces:**
```ts
export type GuestOrderInput = { courseSlug: string; displayName: string; phone: string; email: string; ip: string; termsVersion: string };
export type CreateGuestOrderResult =
  | { kind: "created"; order: OrderView; accessToken: string }
  | { kind: "invalid_phone" | "invalid_email" | "phone_taken" | "email_taken" | "pending_order" | "throttled" | "not_for_sale" };
export function createGuestOrder(input: GuestOrderInput, opts?: { codeSource?: () => string }): Promise<CreateGuestOrderResult>;
export function guestAccessTokenHash(token: string): string; // HMAC như tokenHash của sessions, realm "guest-order"
```
Ba bước như `registerWithPassword`: (1) transaction ngắn dưới khóa IP rồi số rồi email: đếm `password_attempts` kind `guest_order` của IP trong 1 giờ (≥ 10 → `throttled`), ghi một lượt, kiểm `phoneTaken`/`emailInUse` (→ `phone_taken`/`email_taken`), kiểm đơn khách **còn hạn** cùng số hoặc cùng email (→ `pending_order`); (2) `generatedPassword()` + `hashPassword` ngoài transaction; (3) dưới cùng ba khóa kiểm lại trùng số/email/đơn còn hạn, `insertOrder(userId null)`, chèn `guest_orders` (password_enc = niêm phong AES-GCM với AAD `guest-order|<order id>`), `order_terms_acceptances (user_id null)`. Token truy cập: 32 byte ngẫu nhiên base64url, chỉ lưu băm.

- [ ] **Step 1: Test hỏng trước:** `creates a pending order with no user and a guest row` (orders.user_id null, amount = giá khóa, guest_orders.password_hash bắt đầu `scrypt$`, password_enc không chứa mật khẩu rõ); `rejects a phone that has an account` (→ phone_taken); `rejects an email that is a verified identity or a contact email` (→ email_taken, cả hai nguồn); `rejects a second open guest order for the same phone or email` (→ pending_order); `allows a new order after the first expired`; `throttles the 11th guest order from one IP in an hour`; `invalid phone/email`; `concurrent guest orders with the same email: one wins` (hai lời gọi song song, khác số, khác IP → một `created`, một `pending_order`).
- [ ] **Step 2:** chạy → FAIL. **Step 3:** cài đặt. **Step 4:** PASS; test cũ `tests/integration/orders*.test.ts` vẫn PASS sau khi tách `insertOrder`.

### Task 3: Tạo tài khoản khi nhận tiền

**Files:**
- Modify: `src/modules/orders/guest.ts` (thêm hai hàm dưới), `src/modules/enrollments/enroll.ts` (`settleOrder`), `src/modules/ledger/ingest.ts` (`classifyAndSettle`), `src/modules/ledger/match.ts` (`matchTransfers`), `src/app/admin/(panel)/admin-lib.tsx` (nhãn `guest_conflict: "Số/email đã có tài khoản"`), `src/app/(site)/thanh-toan/[code]/checkout.tsx` (câu cho khách nếu lý do này)
- Test: `tests/integration/guest-orders-settle.test.ts`

**Interfaces — Produces:**
```ts
/** Đơn khách (chưa có user) mà số hoặc email nay đã thuộc tài khoản khác. Đơn không phải đơn khách hoặc đã có user → false.
 *  Lấy khóa số rồi khóa email (giữ tới hết transaction) trước khi kiểm. */
export function guestConflict(tx: Tx, orderId: string): Promise<boolean>;
export class GuestConflictError extends Error {}
/** Tạo users + password_logins (băm sẵn, must_change) + learner_pending_credentials (niêm phong lại với AAD user) + learner_contact_emails;
 *  đặt orders.user_id, guest_orders.user_id, xóa guest_orders.password_enc. Trả user id. Không phải đơn khách / đã có user → trả user hiện có. */
export function createAccountForGuestOrder(tx: Tx, orderId: string): Promise<string>;
```
- `settleOrder`: trước mọi ghi chép, `guestConflict` đúng → ném `GuestConflictError`; rồi gọi `createAccountForGuestOrder` trước `UPDATE orders SET status='paid'` (đơn có user thì không đổi gì). Mọi người gọi (SePay, ghép tay, chủ duyệt báo chuyển khoản qua web và Telegram) đều đi qua đây.
- `classifyAndSettle`: khi `classify` ra `auto_confirm` mà `guestConflict` đúng → ghi phân loại `queue` lý do `guest_conflict` và báo Telegram như hàng chờ khác. (Không đổi `CLASSIFIER_VERSION`: đây là bước sau bộ phân loại thuần.)
- `matchTransfers`: `guestConflict` đúng → `{ result: "rejected", reason: "guest_conflict" }` (thêm vào union `MatchResult`), có nhật ký từ chối.
- Chủ duyệt báo chuyển khoản (`src/modules/orders/claims.ts`, `telegram-review.ts`): đơn khách không bao giờ có báo chuyển khoản (cần phiên học viên). Hàm duyệt kiểm **đầu tiên, trước khi ghi dòng sổ tay**: đơn chưa có `user_id` → từ chối `not_claimed` (như đơn không có báo chuyển khoản), không ghi gì vào sổ. Nhờ vậy không có đường nào ghi sổ rồi bị rollback vì `GuestConflictError`.
- `lockIdentityValue(tx, kind: "email" | "phone", value: string): Promise<void>` thêm vào bốn chỗ ghi danh tính nêu ở Global Constraints (thứ tự: sau khóa `users` nếu có).

- [ ] **Step 1: Test hỏng trước:** `SePay payment of a guest order creates the account, enrollment and one order_paid email` (users mới tên đúng, password_logins số đúng + must_change, đăng nhập `loginWithPassword` bằng mật khẩu đọc từ `readPendingCredentials` trả `set_password`, enrollment active, outbox email userId = user mới, guest_orders.password_enc null); `replayed webhook creates one account`; `late money inside the window pays an expired guest order`; `second paid guest order with same phone is queued as guest_conflict` (đơn vẫn chưa paid, không có user mới); `manual match of a conflicting guest order is rejected with guest_conflict`; `settleOrder throws GuestConflictError for a conflicting guest order whatever the caller` (gọi thẳng `settleOrder`, kiểm không có allocation, enrollment, user mới); `concurrent settlement of two guest orders with the same email creates one account` (hai webhook song song, khác số → một paid, một vào hàng chờ `guest_conflict`); `settlement racing a verified email link: one owner` (nhận tiền đơn khách song song với `link.ts` gắn cùng email đã xác minh cho tài khoản khác → hoặc đơn vào hàng chờ, hoặc liên kết thấy trùng; không có hai tài khoản cùng email); `settlement racing a verified phone link: the paid account keeps a usable login` (song song với gắn cùng số đã xác minh → sau cả hai, tài khoản đã trả tiền vẫn đăng nhập được, hoặc đơn vào hàng chờ); `owner approval of a guest order is refused before any ledger write`; `email body contains the temporary password and the phone` (chạy deliver với sender giả).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS; `pnpm test:int` toàn bộ PASS.

### Task 4: API công khai cho đơn khách

**Files:**
- Create: `src/app/api/public/orders/route.ts` (POST), `src/app/api/public/orders/[code]/route.ts` (GET)
- Modify: `src/modules/orders/orders.ts` (tách `checkoutFor(row, group | null)` để dùng chung cho học viên và khách; thêm `getCheckoutForGuest(code, accessToken): Promise<GuestCheckoutView | null>` với `GuestCheckoutView = Omit<CheckoutView, "claim" | "claimable"> & { guest: true; emailMasked: string }`, `enrolled` = đơn đã paid), `src/modules/sessions/cookies.ts` (`guestOrderCookie(code, token)`: tên `__Host-me_order_<code>`, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 7 ngày)
- Test: `tests/integration/guest-orders-api.test.ts`

POST body: `{ courseSlug, displayName, phone, email, emailConfirm, acceptTerms: true }`; `requireSameOrigin`; email ≠ emailConfirm (sau chuẩn hóa) → 400 `email_mismatch`; thiếu cấu hình nhận tiền → 503 `payment_unavailable`; `!emailReady()` → 503 `email_unavailable`; kết quả lỗi → 409 (`throttled` → 429, `invalid_*` → 400) với `{ error }`; tạo được → 201 `{ code }` + Set-Cookie; header `cache-control: no-store`. GET: không cookie hoặc sai → 404 (không lộ đơn tồn tại).

- [ ] **Step 1: Test hỏng trước:** `creates a guest order and sets the access cookie`; `email_mismatch`; `guest checkout requires the access cookie` (không cookie → 404, cookie đơn khác → 404); `paid guest checkout shows a masked email and no password` (body không chứa mật khẩu, có `emailMasked` dạng `n•••@gmail.com`); `cross-origin POST is refused`; `guest checkout is refused when email is not ready` (giả `emailReady` false → 503, không tạo đơn).

`GuestCheckoutView` thêm `emailStatus: "queued" | "sent" | "failed"` lấy từ dòng outbox `order_paid:<order id>:email` (chưa paid → bỏ trống).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS.

### Task 5: Giao diện, gỡ đường cũ, tài liệu

**Files:**
- Modify: `src/app/(site)/mua/[slug]/guest-form.tsx` (gửi tới `/api/public/orders`, rồi `router.push("/thanh-toan/<code>")`; email bắt buộc + "Nhập lại email"; nút "Đặt hàng và thanh toán"; ghi chú dưới email: "Thanh toán xong, hệ thống tạo tài khoản và gửi thông tin đăng nhập vào email này."; `phone_taken`/`email_taken`: "Số điện thoại này đã có tài khoản." / "Email này đã có tài khoản." + link "Đăng nhập để mua" tới `/dang-nhap?next=/mua/<slug>`; `pending_order`: "Số điện thoại hoặc email này đang có đơn chờ thanh toán. Mở lại trang đơn trên máy đã đặt, hoặc đợi hết 15 phút rồi đặt lại."), `src/app/(site)/mua/[slug]/buy-form.tsx` (bỏ `onSignedIn` của khách), `src/app/(site)/thanh-toan/[code]/checkout.tsx` (học viên 401/404 → thử `/api/public/orders/<code>`; khách: không có nút "Tôi đã chuyển khoản"; đã paid: theo `emailStatus` — `sent`: "Đã nhận tiền. Thông tin đăng nhập đã gửi tới <emailMasked>. Xem cả thư mục Spam."; `queued`: "Đã nhận tiền. Hệ thống đang gửi thông tin đăng nhập tới <emailMasked>, thường trong vài phút."; `failed`: "Đã nhận tiền nhưng chưa gửi được email. Chủ khóa học sẽ liên hệ qua số điện thoại của bạn." — kèm nút "Đăng nhập"; bỏ khối hiện mật khẩu ở bước 3), `tests/e2e-ui/guest-checkout.mjs`, `CLAUDE.md` (đoạn Guest checkout), `docs/runbook.md` (mở bán cho khách cần SMTP: đặt `SMTP_USER`/`SMTP_PASSWORD`, rồi gửi thử một thư thật tới email của chủ và xác nhận đã nhận trước khi coi là xong), `src/app/(site)/mua/[slug]/page.tsx` (truyền `guestOpen = emailReady()`; false → thay form khách bằng "Tạo tài khoản rồi mua" (`/dang-ky?next=/mua/<slug>`) và "Đăng nhập")
- Delete (thành mồ côi): `src/app/api/auth/learner/password/quick-register/route.ts`, `src/app/api/me/credentials/route.ts`, `credentialsForOrder` trong `pending-credentials.ts`, nhánh `issued` của `registerWithPassword`, `tests/integration/quick-register.test.ts` (chuyển các ca còn ý nghĩa sang Task 2)
- Modify admin: `src/modules/admin/orders.ts`, `src/modules/admin/overview.ts` (`LEFT JOIN users`, tên/số lấy từ `guest_orders` khi chưa có user, gắn nhãn "Khách")

- [ ] **Step 1:** Sửa e2e `guest-checkout.mjs`: điền form khách → trang thanh toán có QR + mã đơn; số đã có tài khoản → thấy "đã có tài khoản"; nhập SePay giả (webhook ký bằng khóa dev) → trang đơn báo "đã gửi tới n•••@…", hộp thư giả `/dev/thu` có thư chứa số và mật khẩu tạm; đăng nhập bằng mật khẩu đó → bắt đặt mật khẩu mới → vào `/hoc` thấy khóa.
- [ ] **Step 2:** chạy e2e trên dev server → FAIL. **Step 3:** cài đặt giao diện, gỡ đường cũ, sửa admin. **Step 4:** e2e PASS; `pnpm lint`, `pnpm typecheck`, `pnpm test` toàn bộ PASS; ảnh chụp form + trang đơn trên 1280 và 390px.

## Quyết định khi làm (Rulings)

- Task 3: `approveTransfer` (nút "Duyệt" của chủ khi thấy tiền trong app ngân hàng) dùng cho mọi đơn, không chỉ đơn đã báo chuyển khoản; chặn đơn khách ở đó sẽ khiến chủ không duyệt tay được khi SePay bỏ sót. Nên đơn khách **vẫn duyệt được**; chỉ khi `guestConflict` thì từ chối `guest_conflict` qua `Rollback` (dòng sổ nhập tay của lần duyệt đó không được ghi, như các lần từ chối khác). Sai thì: chủ phải nhập lại khi đã xử lý xong trùng tài khoản.
- Task 4/5: `/thanh-toan` thuộc khu học viên (chưa đăng nhập bị chuyển tới đăng nhập), nên trang đơn khách là `/don-hang/<mã>` (công khai), dùng lại `Checkout` với `guest`. Sai thì: một đường dẫn thừa.
- Task 5: bỏ hẳn API hiện mật khẩu ở bước 3 (`/api/me/credentials`) và đăng ký nhanh (`quick-register`) vì chủ chọn "chỉ gửi qua mail"; test vòng đời mật khẩu tạm và thư giữ lại, dùng helper `tests/helpers/guest.ts` đi đúng đường mới.
