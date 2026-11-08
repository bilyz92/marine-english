# Thông tin tài khoản ở bước 3 và qua email khi thanh toán xong Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách mua không cần đăng nhập không còn thấy mật khẩu ở bước 1; bước 3 (đơn đã báo chuyển khoản hoặc đã thanh toán) hiện số điện thoại và mật khẩu tạm; khi đơn thanh toán xong, email gửi thông tin đăng nhập; lần đầu đăng nhập bằng mật khẩu tạm phải đặt mật khẩu mới.

**Architecture:** Đăng ký nhanh vẫn sinh mật khẩu 10 ký tự, lưu băm như cũ nhưng `must_change = true`, và giữ thêm một bản **mã hóa** (AES-256-GCM, khóa `SESSION_ENC_KEYS`, AAD gắn `user_id`) trong bảng `learner_pending_credentials` cho tới khi mật khẩu đã đổi (hoặc 30 ngày). Bước 3 lấy qua `GET /api/me/credentials?order=<mã đơn>`. Email đơn đã thanh toán dựng thân thư lúc gửi (không ghi mật khẩu vào outbox); gửi xong chỉ đánh dấu `emailed_at`, không xóa bản mã hóa (bước 3 "Thanh toán thành công" vẫn cần hiện). Email liên hệ khách nhập ở bước 1 (chưa xác minh) lưu riêng ở `learner_contact_emails`, chỉ dùng để gửi thư, không dùng để đăng nhập.

**Tech Stack:** Next.js 16, Prisma 7 raw SQL, Node `crypto`, Vitest, headless Chrome e2e.

**Spec:** Yêu cầu của chủ 09/11/2026 (hội thoại): "đăng nhập lần đầu tiên sẽ bắt người dùng đổi mật khẩu"; ảnh bước 1 đang hiện mật khẩu → "khi thanh toán xong. thì mới gửi thông tin đăng nhập vào email"; ảnh bước 3 "Khóa học đã mở" → "bước 3 sẽ hiển thị thông tin tài khoản".

## Global Constraints

- Mật khẩu tạm không bao giờ nằm ở dạng rõ trong DB, outbox, log hay nhật ký; chỉ trong phản hồi `GET /api/me/credentials` (`cache-control: no-store, private`) và thân email lúc gửi.
- `GET /api/me/credentials?order=<mã>` chỉ trả khi: phiên học viên là chủ đơn (nhóm gộp), và đơn đang ở bước 3: đã báo chuyển khoản còn mở (claim `open`) hoặc `paid`. Đơn chờ thanh toán, hết hạn, bị từ chối, của người khác → `{ available: false }` (không lộ có hay không). Không có bản chờ → `{ available: false }`.
- Khoảng trống giữa tạo tài khoản và tạo đơn: tạo tài khoản xong, máy đã đăng nhập; tạo đơn lỗi (chưa mở thanh toán, khóa ngừng bán, mất mạng) → khách vẫn đăng nhập, bấm lại là tạo đơn, bản chờ vẫn còn nên tới bước 3 vẫn thấy mật khẩu. Bỏ dở hẳn trên máy khác: số đã có tài khoản → trang mua hỏi mật khẩu, có "Liên hệ hỗ trợ" (chủ đặt mật khẩu tạm) như hiện nay.
- Bản chờ bị xóa khi: mật khẩu của tài khoản đổi bằng bất kỳ đường nào (đặt mật khẩu mới lần đầu, quên mật khẩu, đổi trong Tài khoản, chủ đặt mật khẩu tạm); tài khoản bị gộp; sau 30 ngày (job dọn hằng ngày có sẵn `me.auth.prune-password-attempts` thêm một câu xóa).
- Đăng nhập lần đầu bằng mật khẩu tạm: luồng `set_password` có sẵn (trang đăng nhập và trang mua đều đã hỗ trợ).
- Email liên hệ: chuẩn hóa như hiện tại (`canonicalizeEmail`), không tạo `user_identities`, không dùng để đăng nhập; email đã thuộc tài khoản khác vẫn trả `email_taken` như cũ. Gửi thư: ưu tiên email đã xác minh, không có thì email liên hệ.
- Chữ trên giao diện tiếng Việt, gọi khách là "bạn".

## Review Focus

1. Khách đóng trang trước bước 3 rồi tiền về (SePay sau này) → email vẫn có mật khẩu tạm (bản chờ còn); mở lại trang đơn vẫn thấy.
2. Khách đổi mật khẩu trước khi tiền về → email chỉ báo số điện thoại, không gửi mật khẩu cũ (bản chờ đã xóa).
3. Không có email nào → không gửi được thư; bước 3 vẫn hiện; bản chờ tự hết sau 30 ngày.
4. Người khác (phiên khác) gọi `GET /api/me/credentials` → chỉ thấy của chính mình.
5. Email gửi lỗi rồi thử lại → lần thử lại vẫn có mật khẩu.

---

### Task 1: Lưu bản chờ và email liên hệ, API bước 3

**Files:** migration `prisma/migrations/20261109090000_pending_credentials/migration.sql` (bảng `learner_pending_credentials(user_id uuid pk references users, password_enc text not null, created_at timestamptz default now())`, `learner_contact_emails(user_id uuid pk references users, email text not null, created_at timestamptz default now())`, quyền `me_app` SELECT/INSERT/DELETE), `prisma/schema.prisma`, `src/modules/auth-learner/pending-credentials.ts`, `src/modules/auth-learner/password.ts`, route `quick-register`, route mới `src/app/api/me/credentials/route.ts`, tests `tests/integration/quick-register.test.ts`, `tests/integration/pending-credentials.test.ts`.

**Interfaces — Produces:**
- `sealCredential(userId: string, password: string): string` / `openCredential(userId: string, sealed: string): string | null` (AAD `learner-credential|<userId>`, cùng định dạng `v1.kid…` với `envelope.ts`).
- `savePendingCredentials(tx, userId, password)`, `readPendingCredentials(userId): Promise<{ phone: string; password: string } | null>`, `markCredentialsEmailed(userId)` (đặt `emailed_at`), `dropPendingCredentials(tx | db, userId)`; bảng thêm cột `emailed_at timestamptz` (quyền `me_app` UPDATE cột này).
- `credentialsForOrder(ctx: LearnerCtx, orderCode: string): Promise<{ phone: string; password: string } | null>` kiểm điều kiện bước 3 ở trên.
- `registerWithPassword` thêm `mustChange?: boolean`, `contactEmail?: string`, `pendingPassword?: boolean` (quick-register đặt cả ba).
- Mọi chỗ đổi `password_logins.password_hash` sau khi tạo gọi `dropPendingCredentials` trong cùng giao dịch (hàm cập nhật dòng ở `password.ts:94`, gộp tài khoản `merge.ts`).
- `GET /api/me/credentials?order=<mã>` → `{ available: true, phone: "0912…", password }` | `{ available: false }`.
- Quick-register trả `{ next: "done" }` (không còn `password`).

- [ ] **Step 1: Test hỏng:** quick-register: không còn `password` trong phản hồi; `must_change = true`; bảng chờ có một dòng không chứa mật khẩu rõ; đơn mới tạo (chờ thanh toán) → `available: false`; báo chuyển khoản → trả đúng số và mật khẩu; đơn đã thanh toán → vẫn trả; đơn hết hạn không báo → false; đăng nhập bằng mật khẩu đó → `set_password`; tạo đơn lần đầu lỗi `payment_unavailable` rồi mở thanh toán, tạo lại đơn, báo chuyển khoản → vẫn lấy được mật khẩu; đặt mật khẩu mới xong → `GET` trả `available: false`; phiên học viên khác → không thấy của người này; có email → `learner_contact_emails` có dòng, `user_identities` không.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS + `pnpm test`. **Step 5:** Codex, commit.

### Task 2: Email thông tin đăng nhập khi thanh toán xong

**Files:** `src/modules/outbox/deliver.ts`, `src/modules/outbox/messages.ts`, `src/modules/jobs/…` (dọn bản chờ 30 ngày), test `tests/integration/outbox-credentials.test.ts`.

- `learnerEmail(userId)`: không có email đã xác minh → email liên hệ.
- Gửi `order_paid` qua email: lúc gửi đọc bản chờ; có thì thân thư thêm đoạn "Thông tin đăng nhập: số điện thoại …, mật khẩu tạm … Lần đầu đăng nhập bạn sẽ đặt mật khẩu mới."; không có thì "Đăng nhập bằng số điện thoại … và mật khẩu của bạn." Gửi thành công thì đánh dấu `emailed_at` (không xóa).

- [ ] **Step 1: Test hỏng** (bộ gửi email giả có sẵn): đơn của khách đăng ký nhanh được duyệt → thư tới email liên hệ, có số và mật khẩu, `emailed_at` được đặt, sau đó `GET /api/me/credentials?order=…` của đơn đã thanh toán vẫn trả mật khẩu (bước 3); gửi lỗi lần đầu → bản chờ còn, lần sau thư vẫn có mật khẩu; đã đổi mật khẩu trước → thư không có mật khẩu; outbox `payload` không chứa mật khẩu; dòng chờ 31 ngày bị job dọn.
- [ ] **Step 2–5:** như Task 1.

### Task 3: Giao diện bước 1 và bước 3

- `guest-form.tsx`: bỏ bước "saved" (hiện mật khẩu, sao chép, "Tôi đã lưu mật khẩu"); tạo xong thì sang tạo đơn ngay. Ô email: nhãn "Email (để nhận thông tin đăng nhập khi thanh toán xong)", gợi ý "Không có email thì xem thông tin ở bước 3".
- `checkout.tsx`: khối `AccountInfo` dưới thẻ "Khóa học đã mở" (đơn đã báo chuyển khoản) và "Thanh toán thành công": gọi `GET /api/me/credentials?order=<mã>`; có thì hiện "Tài khoản của bạn", số điện thoại, mật khẩu tạm (nút Sao chép), "Lần đầu đăng nhập trên máy khác bạn sẽ đặt mật khẩu mới.", "Thông tin này sẽ được gửi vào email khi thanh toán xong." (bỏ câu cuối khi đã thanh toán). Thanh bước hiện "3 · Vào học" ở hai trạng thái này.
- e2e `tests/e2e-ui/guest-checkout.mjs` viết lại: bước 1 không có mật khẩu; bước 3 có số và mật khẩu; đăng xuất, đăng nhập bằng mật khẩu đó → buộc đặt mật khẩu mới; `transfer-claim.mjs`, `purchase.mjs` vẫn đạt.

- [ ] **Step 1–5:** e2e viết trước → FAIL → sửa giao diện → PASS (360/390/1280, không lỗi `PAGE_CHECKS`) → Codex, commit.

### Task 4: Hoàn tất

- [ ] CLAUDE.md (mục Guest checkout), `pnpm test`, lint, typecheck, Codex, commit, đẩy GitLab + GitHub; deploy khi chủ nói "deploy đi".
