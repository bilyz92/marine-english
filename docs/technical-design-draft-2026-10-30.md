# Thiết kế kỹ thuật — BẢN NHÁP v2 (30/10/2026)

> Codex `/codex-plan-review` APPROVE ở vòng 10 (77 điểm qua các vòng, đều đã sửa). Vẫn là **bản nháp** cho tới khi G1 và G12a đóng.

**Trạng thái: nháp.** Chưa đối chiếu với tài liệu đặc tả (cổng G1). Chỗ phụ thuộc cổng ghi `[Gx]`. Yêu cầu bắt buộc lấy từ
`docs/design-gates-2026-10-30.md` (gọi tắt **DG**); tệp này mô tả **cách làm**. DG và CLAUDE.md thắng khi lệch.
v2 viết lại sau vòng review Codex thứ nhất (32 điểm). Chưa có code; không tạo code trước khi chủ dự án duyệt plan giai đoạn 1.

## 0. Mức sẵn sàng theo cổng

| Việc | Được làm khi |
| --- | --- |
| Viết / sửa bản nháp này | Bây giờ |
| **Chốt** thiết kế kỹ thuật | G1 đóng (đối chiếu tài liệu đặc tả) và G12a đóng (phần dữ liệu cá nhân) |
| **Viết** plan giai đoạn 1 | G3 đóng (phạm vi) và quyết định D1 bên dưới được duyệt |
| **Bắt đầu** code giai đoạn 1 | Plan được duyệt. (G2 được chủ dự án hoãn ngày 30/10/2026: code trước, Spec + giao diện cập nhật sau, trước ra mắt) |
| Thanh toán | Làm ở P2 với webhook giả lập có chữ ký; **bật SePay thật** khi G4, G5 đóng |
| Đăng nhập số điện thoại | Làm adapter Zalo **tắt** bằng cờ (P1); **bật** khi G6, G15 và phần G12a liên quan đóng |
| Đăng nhập email học viên, link email quản trị, email thông báo | **Làm ngay** (P1) với adapter email giả lập; **bật gửi thật** khi G7 đóng |
| Code bất kỳ bảng/log chứa dữ liệu cá nhân (xem §0.1) | Được tạo bảng/log trong P1 (theo DG mở đầu); thời hạn lưu, xóa, quyền xem chốt ở G12a trước ra mắt |
| Trang quản trị có phân quyền | **Làm ngay** (P1) với ma trận đề xuất đặt thành hằng cấu hình; **chốt** khi G11 đóng |
| Thiết bị (giới hạn 2) | **Làm ngay** (P1) với `MAX_DEVICES` cấu hình; **chốt** khi G10 đóng |
| Offline (giấy phép, đồng bộ) | Làm ở P3 với thời hạn cấu hình; **chốt** khi G9, G10 đóng |
| Triển khai thật | G8 đóng |
| Ra mắt | Mọi cổng “chặn ra mắt” (G12b, G13, G14) đóng, có bằng chứng |

| Bảng sau phụ thuộc cổng | Cổng |
| --- | --- |
| §4 SePay (hợp đồng chữ ký, mã tham chiếu, đối soát) | G4, G5 |
| §5.3 OTP qua Zalo, §5.4 tài khoản chỉ có số | G6, G15 |
| §5.3 OTP email, §5.5 link email quản trị, thông báo email | G7 |
| §5.0 D1, §5.8 hợp đồng Google OAuth | D1 |
| §5.5 phiên quản trị, ma trận quyền | G11 |
| §6 offline, §5.6 thiết bị | G9, G10 |
| §8 vận hành, sao lưu | G8 |
| Mọi bảng/log ở §0.1 | G12a |

### 0.1 Dữ liệu cá nhân phụ thuộc G12a
Mỗi mục sau cần trong bảng dữ liệu G12a: mục đích, bên xử lý, thời hạn lưu, cách xóa/ẩn danh, ai được xem, xử lý trong bản sao lưu:
`users`, `user_identities` (số điện thoại, email, Google sub), `otp_challenges`, `otp_send_log`, `otp_rate_buckets` (IP), `learner_sessions`,
`login_tickets`, `admin_email_links`, `session_token_history` (hash token cũ, giữ 37 ngày rồi job dọn xóa; trong bản sao lưu còn tới khi bản sao hết hạn), `devices`, hồ sơ 8A (`crew_profiles`, `training_interests`, `consents`, `data_requests`), `orders` (người mua), `bank_transactions`
và `bank_transaction_observations` (tên người chuyển, nội dung, dữ liệu gốc), `refunds` (tài khoản nhận hoàn), `learning_events`, `learning_progress`,
`quiz_attempts`, `sync_rejections` (sự kiện học bị từ chối, giữ để hỗ trợ), `enrollments` (ai học gì, lý do cấp), `coupon_reservations`, `payment_allocations` và `bank_transaction_dispositions` (người thao tác),
`bank_transaction_verifications`, `refund_sources`, `refund_adjustments`, `refund_adjustment_sources` (người thao tác, bằng chứng), `admin_users`, `admin_identities`, `admin_sessions`,
`admin_audit_log` (IP, giá trị trước/sau), `job_requests` (người yêu cầu), `outbox_events` (nội dung tin), **tệp bằng chứng** (ảnh chuyển khoản, sao kê),
**ghi âm** của học viên (khi có), log ứng dụng, log truy cập Caddy (IP), log an ninh webhook, bản sao lưu DB và media.

**D1 — đã duyệt 30/10/2026:** không dùng Auth.js; tự quản lý phiên + `openid-client` cho Google. Lý do ở §5.0. **G3 đã đóng 30/10/2026** (phạm vi theo DG §10).

## 1. Triển khai trên một VPS [G8]

Docker Compose, các dịch vụ:

| Dịch vụ | Vai trò | Volume | Kiểm tra sống | Mạng |
| --- | --- | --- | --- | --- |
| `caddy` | HTTPS (Let's Encrypt), reverse proxy, phục vụ tệp **công khai** | `caddy_data` (chứng chỉ, bắt buộc bền), `media` chỉ đọc phần `public/` | HTTP | cổng 80/443 ra ngoài |
| `app` | Next.js (output standalone): website, PWA, API, trang quản trị | `media` (đọc/ghi) | `GET /api/health` (DB đọc được) | nội bộ |
| `worker` | cùng image, lệnh `worker`: lập lịch, job, gửi outbox, **sao lưu** (có `pg_dump`) và dọn media | `media`, **`locks`** (volume tên `me_locks`, gắn tại `/data/locks`) | tệp heartbeat / lệnh kiểm tra | nội bộ |
| `postgres` | PostgreSQL | `pgdata` | `pg_isready` | chỉ nội bộ |

- Giới hạn CPU/RAM từng container. Ngân sách kết nối DB: `max_connections` 50; pool `app` 10, `worker` 7 (gồm sao lưu), quản trị/migration 3.
- **Khóa tệp dùng chung:** chỉ container `worker` (bản cũ và bản mới khi deploy) tham gia sao lưu và dọn media; cả hai gắn **cùng** volume `me_locks` tại
  `/data/locks`. Khi khởi động, worker ghi `stat` (thiết bị + inode) của tệp khóa vào log và vào DB; nếu khác giá trị đã ghi lần trước (volume bị đổi) thì
  cảnh báo và không chạy sao lưu/dọn media. Test: hai tiến trình worker trên cùng volume chỉ một bên giữ được khóa.
- Hai vai trò DB: `me_migrator` (DDL, chỉ dùng khi migrate) và `me_app` (DML, không DDL, không TRUNCATE; không DELETE trên bảng tài chính/nhật ký).
- Bí mật trong tệp env trên VPS (quyền 600), sao lưu riêng có mã hóa: khóa phiên, pepper OTP (theo phiên bản), khóa ký giấy phép offline (theo `kid`),
  khóa HMAC SePay (hiện tại + cũ khi đổi), mật khẩu DB, token Telegram/Zalo/email.
- NTP bật. Múi giờ hệ thống UTC; giờ hiển thị Asia/Ho_Chi_Minh.
- Deploy: GitLab CI build image → registry → trên VPS: `migrate deploy` bằng `me_migrator` → khởi động lại `app` (đợi health xanh) → gửi SIGTERM cho
  `worker` cũ (hoàn tất job đang chạy, nhả lease, thoát trong 60 giây) → chạy `worker` mới. Giữ tag image trước để quay lại; migration phải tương thích
  ngược một phiên bản (thêm trước, xóa sau).
- Cảnh báo (Telegram nhóm lỗi): app/worker không sống, ổ đĩa 70%/85%, RAM, chứng chỉ < 14 ngày, sao lưu thiếu/lỗi, job lỡ lịch/lỗi/kẹt, outbox `dead`,
  webhook lỗi chữ ký tăng bất thường. Mỗi cảnh báo có runbook ngắn trong `docs/`. Người nhận khi chủ dự án ở biển: [G8].

## 2. Mã nguồn

- Next.js App Router, TypeScript strict, một repo.
- **ORM: Prisma (chốt).** Migration có phiên bản, `migrate deploy`. Trigger, index một phần, CHECK, hàm PL/pgSQL viết bằng SQL trong thư mục migration
  (Prisma cho phép migration SQL tùy chỉnh); người viết migration chịu trách nhiệm phần SQL đó, soát bằng skill `prisma-migration-safety`.
- **Tiền:** cột `bigint` VND. Prisma trả `BigInt`; ở ranh giới API đổi sang `number` sau khi kiểm `<= Number.MAX_SAFE_INTEGER` (VND luôn nhỏ hơn nhiều).
- Zod cho mọi đầu vào. Route và server action chỉ kiểm đầu vào + **kiểm quyền lại** rồi gọi module; transaction nằm trong module.
- **Transaction:** mức cô lập `READ COMMITTED` (mặc định Postgres) + khóa dòng tường minh. `lock_timeout` 3 giây, `statement_timeout` 10 giây trong
  transaction tài chính; gặp deadlock (40P01) hoặc lỗi tuần tự hóa (40001) thì thử lại tối đa 3 lần có giãn cách ngẫu nhiên.
- **Thứ tự khóa toàn cục** (mọi thao tác tiền phải theo): `users` (nếu cần) → `bank_transactions` (id tăng dần) → `orders` (id tăng dần) →
  `coupon_reservations` → `enrollments` → `refunds`. Không gọi dịch vụ ngoài bên trong transaction.

Thư mục:

```
src/
  app/                    # (site), (learn), quan-tri/, api/
  modules/ catalog orders ledger payments-sepay enrollments auth-learner auth-admin sessions offline storage notify jobs audit
  worker/                 # điểm vào worker + CLI (admin:bootstrap…)
prisma/ (schema + migrations SQL)
tests/  unit | integration (Postgres thật, chạy song song) | e2e
```

## 3. Cơ sở dữ liệu

Quy ước: `timestamptz` UTC; khóa ngoại mặc định `ON DELETE RESTRICT` (không xóa cứng dữ liệu tài chính, nhật ký, định danh); trạng thái dùng enum hoặc
CHECK. Chi tiết ràng buộc ở **Phụ lục A**.

### 3.1 Học viên
`users`, `user_identities` (kind phone/email/google; `value_canonical`; `google_sub` cho Google), `otp_challenges`, `otp_rate_buckets`,
`otp_send_log`, `learner_sessions`, `devices`, hồ sơ theo 8A (`crew_profiles`, `training_interests`, `consents` chỉ thêm, `data_requests`) [G12a].

### 3.2 Quản trị
`admin_users` (email_lower, role owner/support, status invited/active/expired/revoked, invite_expires_at), `admin_identities` (google_sub / email),
`admin_sessions`, `admin_audit_log` (chỉ thêm, ghi cả lần bị từ chối).

### 3.3 Nội dung
`courses`, `course_versions`, `lessons` (is_free_trial), `lesson_versions` (JSON nội dung + hash), `media_assets` (storage_key, mime, bytes, sha256,
visibility public/protected), **`lesson_version_assets`** (lesson_version_id, media_asset_id, vai trò: audio/ảnh/…; duy nhất cặp). Một tệp có thể dùng
lại ở nhiều phiên bản bài. Tệp media **bất biến**: mỗi phiên bản là tệp mới, tên theo sha256, không ghi đè.
- **Quyền tải một tệp được bảo vệ:** có ít nhất một `lesson_version_assets` trỏ tới tệp mà bài thuộc khóa người học đang có quyền (theo nhóm gộp), **hoặc**
  bài là bài học thử (`is_free_trial`). Tệp chỉ dùng cho bài học thử hoặc trang bán hàng thì để `public`. Không dùng `visibility` một mình để cho phép.

### 3.4 Tiền
| Bảng | Vai trò |
| --- | --- |
| `orders`, `order_items` | Đơn + ảnh chụp bất biến (§3.5) |
| `coupons`, `coupon_reservations` | Giữ chỗ / trừ lượt / nhả / vượt hạn mức (DG §2.2) |
| `bank_transactions` | **Sự thật bất biến** của giao dịch tiền vào, khóa định danh chuẩn (§4.1) |
| `bank_transaction_observations` | Mỗi lần một nguồn báo về giao dịch (webhook/API/nhập tay): dữ liệu như nguồn báo, chỉ thêm |
| `bank_transaction_verifications` | Ai/cách nào xác minh (chủ; hoặc nguồn nhà cung cấp khớp), chỉ thêm |
| `bank_transaction_classifications` | Kết quả bộ phân loại từng lần chạy: phiên bản, mã ứng viên, đơn ứng viên, kết quả, lý do; chỉ thêm |
| `payment_allocations` | Dòng sổ → đơn (DG) |
| `bank_transaction_dispositions` | `duplicate` / `ignored` + lý do (DG) |
| `refunds` | Tiền ra, `kind` full/excess (§4.6) |
| `enrollments` | Quyền học có nguồn gốc |

### 3.5 Đơn bất biến và chuyển trạng thái (trigger)
- Cột **không sửa được** sau INSERT (trigger `BEFORE UPDATE` báo lỗi nếu đổi): `code`, `user_id`, `created_at`, `expires_at`, `amount_due_vnd`,
  `currency`, `coupon_id`, `coupon_discount_vnd`, `refund_policy_version`. `order_items`: không UPDATE, không DELETE.
- CHECK: `amount_due_vnd > 0`, `currency = 'VND'`, `expires_at = created_at + interval '15 minutes'`, `coupon_discount_vnd >= 0`,
  tổng `order_items.final_price = amount_due_vnd` (kiểm khi tạo, trong cùng transaction, bằng constraint trigger hoãn tới cuối transaction).
- Trigger chuyển trạng thái, chỉ cho phép: `pending→paid`, `pending→expired`, `expired→paid`, `paid→refunded`. Đồng bộ thời điểm:
  `paid_at` NOT NULL ⇔ status ∈ {paid, refunded}; `refunded_at` NOT NULL ⇔ status = refunded; `expired_at` có khi từng hết hạn.
- “Cần xử lý tay” không phải trạng thái (DG §2.3) — là view (§4.7).

## 4. Thanh toán

### 4.1 Định danh giao dịch [G4]
- `bank_transactions`: `bank_code` (danh sách mã ngân hàng cố định, chữ hoa), `account_no` (chỉ chữ số), `bank_ref` (bỏ khoảng trắng hai đầu, chữ hoa)
  — cả ba **NOT NULL**; duy nhất `(bank_code, account_no, bank_ref)`. `amount_vnd > 0`, `currency = 'VND'`, `direction = 'in'`, `bank_time` NOT NULL.
  Toàn bộ cột không sửa (trigger).
- Nếu một nguồn không cung cấp được `bank_ref` dùng được **hoặc `bank_time`** hợp lệ: **không** tạo dòng sổ; ghi `bank_transaction_observations` với
  `bank_transaction_id = NULL`, `unresolved_reason = missing_ref | missing_time` và đưa vào hàng chờ “thiếu dữ kiện” để chủ bổ sung từ sao kê (khi đó
  đi theo luồng nhập sao kê §4.5). Không sửa observation cũ: observation mới (nhập sao kê) mang cột `resolves_observation_id` trỏ tới nó,
  duy nhất (mỗi observation chưa giải quyết chỉ được giải quyết một lần). Chống trùng sự kiện nhà cung cấp: duy nhất `(source, provider_event_id)` khi có. Kiểm thử ở G4: SePay có trả mã tham chiếu ngân hàng
  và thời điểm giao dịch không.

### 4.2 Webhook `POST /api/payments/sepay/webhook` [G4]
- Giới hạn body 64 KB, chỉ `application/json`. Đọc byte gốc trước khi parse.
- **Hạn chót một request: 8 giây** tính từ lúc nhận. Mỗi lần thử transaction: `lock_timeout` 2 giây, `statement_timeout` 3 giây; chỉ thử lại (deadlock,
  lỗi tuần tự hóa, hết thời gian khóa) khi còn ≥ 3,5 giây; hết thời gian → 503 để SePay gửi lại. Quy tắc này thay mức chung ở §2 cho webhook; đối soát API
  (worker) dùng mức chung.
- Kiểm `X-SePay-Timestamp` ±5 phút; HMAC theo hợp đồng SePay; `crypto.timingSafeEqual`; thử khóa hiện tại rồi khóa cũ (khi đang đổi).

| Tình huống | Phản hồi | Ghi lại |
| --- | --- | --- |
| Thiếu/sai header, sai chữ ký, quá cửa sổ thời gian | 401 | log an ninh (không kèm bí mật, không kèm body đầy đủ) |
| Chữ ký đúng nhưng body hỏng | 400 | log + cảnh báo |
| Hợp lệ nhưng không liên quan (tiền ra, tài khoản khác, không phải VND) | 200 | observation `ignored_reason` |
| Hợp lệ, đã có (trùng) | 200 | observation |
| Hợp lệ, ghi thành công | 200 | như §4.3 |
| Lỗi tạm thời (DB không kết nối được, hết thời gian khóa sau 3 lần thử) | 503 | để SePay gửi lại |

### 4.3 `ledger.ingest(report)` — một transaction
`report` là dữ liệu một nguồn báo về (webhook, API, nhập tay), chưa ghi gì.
1. Chuẩn hóa định danh và thời điểm. Thiếu `bank_ref` hoặc `bank_time` → ghi observation không liên kết (§4.1) → kết thúc.
2. `INSERT bank_transactions … ON CONFLICT DO NOTHING RETURNING id` (biết là dòng mới hay cũ); rồi `SELECT … FOR UPDATE` dòng sổ.
3. Ghi `bank_transaction_observations` **liên kết** với dòng sổ đó (chỉ thêm), kèm cờ `is_first` nếu là dòng mới.
4. **Dòng mới, nguồn là SePay đã xác thực (webhook có chữ ký hoặc API có xác thực)** → ghi `bank_transaction_verifications` (method `provider`).
   Dòng mới nguồn nhập tay → chưa xác minh.
5. **Dòng cũ:** so **chính xác** số tiền, `bank_time`, tài khoản với dòng chuẩn (không có dung sai, trừ khi G4 chốt một quy tắc chuẩn hóa và DG được
   cập nhật). **Lệch** → đánh dấu observation `mismatch`, outbox cảnh báo chủ, **không** xác minh, kết thúc. **Khớp** và nguồn là SePay đã xác thực →
   ghi verification (method `provider_match`) nếu dòng chưa có xác minh.
6. Dòng chưa xác minh (nhập tay chưa được chủ hay nhà cung cấp xác minh) → kết thúc.
7. Dòng đã có phân bổ hoặc kết luận hiệu lực → kết thúc (idempotent).
8. Phân loại (§4.4): ghi `bank_transaction_classifications`.
9. Kết quả tự xác nhận → `SELECT orders … FOR UPDATE` → kiểm lại trạng thái → `payment_allocations` (kind auto) → `orders.status = paid` →
   trừ lượt mã giảm giá (khóa `coupon_reservations` của đơn) → `enrollments` (source order) → `outbox_events`.
10. Commit. Lỗi tạm thời → rollback, thử lại theo §2 trong hạn chót của request (§4.2).

Webhook, đối soát API và lần xác minh tay (§4.5) **đều** gọi đúng hàm này (webhook và API vào từ bước 1; xác minh tay vào ở §4.5), nên giao dịch nhập tay được SePay báo sau cũng được phân loại.

### 4.4 Bộ phân loại (thuần, có phiên bản)
Đầu vào: dòng sổ + đơn ứng viên. Tách mã: chuẩn hóa nội dung (chữ hoa, bỏ dấu, bỏ ký tự ngoài A–Z0–9 thành khoảng trắng), tìm mọi chuỗi khớp
`ME[bảng ký tự]{8}`. Áp bảng DG §2.3 với `bank_time` (`created_at <= bank_time < expires_at`, UTC; thời điểm tương lai > 5 phút → hàng chờ;
thiếu thời điểm đã bị chặn ở §4.1 nên không tới đây).
Kết quả: `auto_confirm` | `queue:<lý do>` (no_code, multi_code, unknown_code, amount_short, amount_over, late, order_paid, order_refunded, bad_time).

### 4.5 Thao tác tay (DG §2.1, 2.8)
- **Nhập sao kê:** gọi `ledger.ingest` với nguồn manual (`entered_by`, bằng chứng); dòng sổ mới chưa xác minh; nếu trùng dòng đã có thì xử lý như bước 5.
- **Xác minh tay** — một transaction: chỉ owner; **khóa dòng sổ `FOR UPDATE` trước** (theo thứ tự §2); CHECK/trigger `verified_by <> entered_by`;
  bắt buộc bằng chứng; ghi `bank_transaction_verifications` (method owner) → tiếp bước 7–10 của §4.3 trong cùng transaction.
- **Ghép tay** — một transaction, khóa theo thứ tự §2 (các dòng sổ trước, rồi đơn); mọi dòng phải đã xác minh và chưa có phân bổ/kết luận:

| Luồng | Điều kiện | Kết quả | Ai |
| --- | --- | --- | --- |
| Đúng tiền, sai/thiếu mã | 1 dòng, tổng = số phải trả | phân bổ, paid, quyền học | hỗ trợ |
| Đúng tiền, đến muộn | như trên, đơn pending/expired | như trên | hỗ trợ |
| Chuyển bù | ≥ 2 dòng, tổng = số phải trả | phân bổ tất cả, paid | **chủ** |
| Thiếu tiền | tổng < số phải trả | **không** đổi đơn; chờ chuyển bù hoặc hoàn | chủ |
| Thừa tiền | tổng > số phải trả | phân bổ, paid, **cùng transaction** tạo `refunds` kind excess (requested, số = tổng − số phải trả) | hỗ trợ (hoàn do chủ duyệt; nhiều dòng sổ thì chủ) |
| Không liên quan | — | `bank_transaction_dispositions` ignored | chủ |
| Trùng | — | disposition duplicate (+ có thể hoàn) | chủ |

  Mọi luồng ghi `admin_audit_log` (trước/sau, chênh lệch, bằng chứng).
- **Số tiền phân bổ (nhiều dòng sổ):** mỗi `payment_allocations.amount_vnd` = **toàn bộ** số tiền của dòng sổ đó (tiền đã vào thì gắn hết vào đơn).
  Phần thừa được hoàn qua refund excess; refund ghi nguồn qua bảng `refund_sources` (refund_id, bank_transaction_id, amount_vnd), tổng các nguồn = số
  hoàn; mặc định lấy từ dòng sổ có `bank_time` muộn nhất trước, rồi các dòng trước đó (quy tắc cố định để kết quả lặp lại được).
- **Loại trừ phân bổ / kết luận:** cả hai bảng chỉ được ghi khi đang giữ khóa `FOR UPDATE` trên dòng sổ; thêm constraint trigger kiểm bảng còn lại
  (an toàn vì đã tuần tự hóa qua khóa dòng sổ); index duy nhất một phần cho kết luận đang hiệu lực (`superseded_at IS NULL`).
- **Ghép nhầm:** phân bổ là bất biến; giai đoạn 1 **không** có thao tác chuyển phân bổ sang đơn khác. Ghép nhầm thì hoàn tiền cho đơn đó (refund full,
  có thu hồi quyền học) rồi để khách thanh toán lại đúng đơn; mọi bước có audit.
- **Cấp không thu tiền:** owner, lý do bắt buộc; `enrollments` source grant; không đụng `orders`.

### 4.6 Hoàn tiền (DG §2.9) [G13]
- `refunds.kind`: `full` (hoàn cả đơn) | `excess` (hoàn phần thừa). Trạng thái: `requested → approved → sent → confirmed`, hoặc `failed`/`cancelled`;
  trigger chỉ cho các bước này; `out_bank_ref` NOT NULL từ `sent`, duy nhất.
- Tối đa một refund `full` đang hiệu lực (không failed/cancelled) mỗi đơn — index duy nhất một phần.
- `full` → `confirmed`: một transaction khóa dòng sổ liên quan → đơn → enrollments → refund: đơn `refunded`, thu hồi enrollments có `order_id` của đơn,
  outbox. `excess` → `confirmed`: chỉ cập nhật refund; đơn giữ `paid`.
- Nguồn tiền của refund **chỉ** qua bảng `refund_sources` (§4.5) — `refunds` **không** có cột `bank_transaction_id`. Refund full lấy nguồn từ mọi dòng sổ
  đã phân bổ cho đơn. **Giới hạn cộng dồn:** với mỗi dòng sổ, **số hoàn hiệu lực** (tổng `refund_sources.amount_vnd` + tổng delta điều chỉnh theo dòng sổ đó, chỉ tính refund
  chưa `failed`/`cancelled`) ≤ `amount_vnd` của dòng sổ — mọi kiểm tra (khi thêm nguồn gốc lẫn khi thêm điều chỉnh) đều dùng số hiệu lực này, nên tiền đã
  được nhả bởi reversal có thể dùng lại cho refund sau.
- **Nghĩa tiền của từng loại refund:** `full` — `amount_vnd` **bằng đúng** `orders.amount_due_vnd` (tiền gốc của đơn), lấy từ các dòng sổ đã phân bổ cho đơn;
  `excess` — tổng số hoàn hiệu lực của mọi refund excess của đơn ≤ (tổng `payment_allocations.amount_vnd` của đơn − `amount_due_vnd`). Kiểm bằng constraint
  trigger hoãn, sau khi đã khóa đơn và dòng sổ. Mọi thao tác tạo, đổi, hủy, xác nhận refund khóa các dòng sổ nguồn `FOR UPDATE` (theo thứ tự §2) trước rồi kiểm tổng; constraint trigger kiểm lại
  khi commit.
- **Điều chỉnh sau khi đã xác nhận** (bảng `refund_adjustments`: refund_id, kind `reversal` | `amount_correction`, amount_delta_vnd, lý do, bằng chứng,
  người làm, thời điểm; chỉ thêm, chỉ owner, có audit). `reversal` (ngân hàng trả lại tiền hoàn) **không** tự đổi trạng thái đơn hay quyền học: đơn vẫn
  `refunded`; nếu cần khôi phục quyền học thì owner dùng “cấp không thu tiền” với lý do tham chiếu điều chỉnh.
- **Điều chỉnh đi qua nguồn tiền:** mỗi điều chỉnh có các dòng `refund_adjustment_sources` (adjustment_id, bank_transaction_id, amount_delta_vnd);
  tổng các dòng = `amount_delta_vnd` của điều chỉnh. `reversal` = trả lại toàn bộ (delta âm bằng số đã hoàn từ từng nguồn), tức **nhả** nguồn; `amount_correction`
  có thể âm hoặc dương theo từng nguồn. **Số hoàn hiệu lực** của refund = `amount_vnd` + tổng delta; của một dòng sổ = tổng `refund_sources` + tổng delta theo
  dòng sổ đó (chỉ tính refund chưa failed/cancelled). Điều chỉnh và các dòng nguồn của nó được chèn **trong cùng một transaction**; cả hai bảng **bất biến** (trigger chặn UPDATE/DELETE); duy nhất
  `(adjustment_id, bank_transaction_id)`. Ràng buộc: số hoàn hiệu lực theo refund ≥ 0 và = tổng hiệu lực theo nguồn; theo dòng sổ: 0 ≤ … ≤
  `amount_vnd` của dòng sổ. Mọi transaction tạo điều chỉnh (và mọi thao tác tạo/đổi/hủy/xác nhận refund) khóa theo thứ tự §2: các dòng sổ nguồn `FOR UPDATE` theo id tăng dần →
  dòng `orders` chung → dòng `refunds` cha — rồi mới chèn và kiểm các tổng theo dòng sổ, theo refund, theo đơn; constraint trigger kiểm lại. Báo cáo dùng số hiệu lực.

### 4.7 Hàng chờ xử lý tay (view)
Dòng sổ không có phân bổ và không có kết luận hiệu lực, kèm **lần phân loại gần nhất** (lý do, mã ứng viên, đơn ứng viên). Cờ “cần xử lý tay” của đơn =
có ít nhất một dòng trong view với `candidate_order_id` là đơn đó. Dòng không có mã vẫn nằm trong hàng chờ chung. Thêm hàng chờ “thiếu mã tham chiếu” (§4.1)
và “chờ xác minh” (nhập tay chưa xác minh).

### 4.8 Đối soát API [G4]
`reconciliation_cursors` (provider, bank_code, account_no, last_complete_bank_time, last_cursor_token, updated_at). Mỗi lần chạy: đọc từ
`last_complete_bank_time − 2 giờ`, phân trang ổn định theo (bank_time, id của nhà cung cấp), gọi `ledger.ingest` từng giao dịch; **chỉ** cập nhật con trỏ
sau khi xử lý hết các trang. Máy chủ ngừng lâu: chạy bù nhiều lô cho tới hiện tại. Khoảng cần bù vượt thời gian SePay còn giữ dữ liệu → cảnh báo chủ đối
soát bằng sao kê. Lỗi → `job_runs` + cảnh báo.

### 4.9 Tạo đơn và hết hạn
- Tạo đơn (một transaction): giá từ `courses`; mã giảm giá khóa dòng `coupons` `FOR UPDATE`, kiểm còn lượt (tính cả giữ chỗ), tạo `coupon_reservations`
  (`reserved_until = expires_at + 45 phút`); mã đơn CSPRNG, thử lại khi trùng, quá 5 lần → lỗi rõ ràng.
- Job mỗi phút: `pending → expired` khi `expires_at < now()`; nhả giữ chỗ khi `reserved_until < now()` và chưa dùng. Giao dịch trong hạn đến muộn sau khi
  đã nhả: vẫn `paid`, ghi `coupon_reservations.overrun = true`.

## 5. Đăng nhập và phiên

### 5.0 D1 — tự quản lý phiên, không dùng Auth.js (đã duyệt 30/10/2026)
**Quyết định:** phiên tự quản lý — token ngẫu nhiên 256 bit trong cookie — cho cả hai khu vực. **Không lưu token dạng chữ rõ.** Kiểm phiên luôn dựa trên HMAC của token;
ngoại lệ duy nhất là phong bì `next_token_enc` (token mới được **mã hóa**, chỉ tồn tại 2 phút sau mỗi lần xoay, §5.2). Giả định khi bị lộ: người có cả DB
**và** `SESSION_ENC_KEYS` trong 2 phút đó có thể lấy được token mới của phiên vừa xoay; vì vậy khóa mã hóa để riêng với DB và với bản sao lưu DB, và
phong bì bị xóa ngay khi hết cửa sổ; Google qua `openid-client`
(§5.8); OTP email/Zalo và link email quản trị tự viết theo §5.3 và §5.5. **Không dùng Auth.js.** Lý do: cần mã OTP có vòng đời riêng, thu hồi phiên ngay,
gắn phiên với thiết bị và tách hẳn hai khu vực; Auth.js gắn đăng nhập bằng mã với phiên JWT và khó chạy hai cấu hình cạnh nhau.

### 5.1 Phân loại đường dẫn (kiểm ở middleware **và** lại trong từng handler)
| Nhóm | Đường dẫn | Xác thực |
| --- | --- | --- |
| Công khai | trang bán hàng, `/api/public/**` (danh mục, bài học thử), `/api/health` | không |
| Nhà cung cấp | `/api/payments/sepay/webhook` | HMAC SePay (§4.2), không phiên |
| Đăng nhập | `/api/auth/learner/**`, `/api/auth/admin/**` (gửi mã, xác minh, OAuth callback) | theo luồng, có CSRF/state |
| Học viên | `/api/learn/**`, `/api/me/**`, trang học | phiên học viên + thiết bị hợp lệ |
| Quản trị | `/quan-tri/**`, `/api/quan-tri/**` | phiên quản trị + quyền theo ma trận |
| Nội bộ | không có route HTTP; job chạy trong worker | — |

### 5.2 Phiên
- Cookie học viên `__Host-me_learn`, quản trị `__Host-me_admin`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`. Token khác nhau, hash bằng HMAC với
  hai khóa riêng; bảng `learner_sessions` / `admin_sessions` riêng.
- Thao tác thay đổi trạng thái: kiểm `Origin` khớp tên miền + token CSRF gắn phiên. OAuth: `state` + PKCE lưu trong cookie tạm riêng từng khu vực,
  hết hạn 10 phút.
- **Học viên** (đề xuất, chờ G9/G10): phiên gắn `device_id`; hạn tuyệt đối 90 ngày, nhàn rỗi 37 ngày (khớp giấy phép offline 30 + ân hạn 7, để người đi
  tàu dài ngày không bị đăng xuất khi chưa có mạng). **Xoay token** (mỗi lần đồng bộ thành công nếu token đã quá 7 ngày): khóa dòng phiên `FOR UPDATE` → sinh token mới → lưu `token_hash`
  mới, `prev_valid_until = now() + 2 phút`, `next_token_enc`, và **thêm một dòng `session_token_history`** (session_id, token_hash của token
  cũ, `detect_until = now() + 37 ngày`) → commit → trả cookie. Mỗi lần xoay thêm một dòng lịch sử, nên mọi token cũ đều được theo dõi đủ 37 ngày.
  - **Phong bì `next_token_enc`** (chỉ tồn tại trong cửa sổ 2 phút): `v1.<kid>.<nonce>.<ciphertext>.<tag>` (base64url); AES-256-GCM, nonce 12 byte ngẫu nhiên mới
    mỗi lần, tag 16 byte; dữ liệu xác thực kèm (AAD) = `realm|session_id|token_hash mới` nên không chép sang phiên khác được. Khóa lấy từ `SESSION_ENC_KEYS`
    (nhiều khóa theo `kid`, một khóa hiện hành). Sau khi giải mã phải kiểm `HMAC(token) = token_hash` hiện tại. Đổi khóa: phong bì mới dùng khóa mới, giữ khóa
    cũ ≥ 2 phút (đủ cửa sổ) rồi bỏ; phong bì không giải mã được coi như hết cửa sổ.
  - Token cũ dùng **trong** 2 phút: khóa dòng, giải mã, trả cookie token **hiện tại** (không xoay thêm) — xử lý mất phản hồi, nhiều tab, khởi động lại tiến trình.
  - Token cũ dùng trong cửa sổ được nhận ra bằng dòng lịch sử **mới nhất** của phiên.
  - Hết 2 phút: xóa `next_token_enc` và `prev_valid_until` (khi gặp hoặc bởi job dọn). Token khớp **bất kỳ** dòng `session_token_history` còn `detect_until`
    → coi là bị đánh cắp: thu hồi cả phiên. Dòng lịch sử quá `detect_until` bị job dọn xóa; sau đó token đó chỉ bị từ chối.
  - Test: mất phản hồi; hai tab cùng xoay; khởi động lại giữa chừng; token cũ ở phút thứ 3 thu hồi phiên; xoay 3 lần trong 37 ngày rồi dùng token đời đầu → thu hồi phiên; phong bì bị sửa, sai `kid`, chép sang phiên khác bị
    từ chối; đổi khóa trong cửa sổ.
  `last_seen_at` cập nhật tối đa 5 phút một lần. Mọi request được bảo vệ đều kiểm phiên trong DB (chưa hết hạn, chưa thu hồi, thiết bị còn hiệu lực).
  Thao tác nhạy cảm (liên kết/gỡ định danh, xóa tài khoản, đổi thiết bị) cần xác thực lại trong 10 phút. Job dọn phiên hết hạn hằng ngày.
- **Quản trị:** tối đa 12 giờ, nhàn rỗi 1 giờ (đề xuất); kiểm trong DB mỗi request.
- Đăng xuất một khu vực không ảnh hưởng khu vực kia. Một trình duyệt có thể có cả hai phiên cùng lúc; phiên này không bao giờ được chấp nhận ở khu vực kia.

### 5.3 OTP (DG §3) [G6, G7]
- **Phát mã** — một transaction: `pg_advisory_xact_lock(ns_otp, hash(purpose, value))` tuần tự hóa theo định danh → `UPSERT otp_rate_buckets … RETURNING count`
  cho từng phạm vi (định danh/10 lần 24 giờ, IP/giờ, ngân sách ZNS toàn hệ thống/ngày — dòng ngân sách khóa `FOR UPDATE`) và khoảng chờ 60 giây; vượt → từ chối
  trung tính → đánh dấu mã cũ `invalidated_at` → sinh mã CSPRNG → lưu `HMAC(pepper[key_version], purpose|value|code)`. Index duy nhất một phần: tối đa một
  thử thách hiệu lực cho (purpose, value). Commit.
- **Gửi mã:** sau commit, **gửi trực tiếp trong request** tới Zalo ZNS/email (timeout 10 giây); mã thô chỉ nằm trong bộ nhớ, **không** vào outbox, DB hay log.
  Gửi lỗi → đánh dấu thử thách `delivery_failed` (không tính lượt nhập sai), người dùng bấm gửi lại (vẫn tính hạn mức).
- **Hạn mã:** `created_at` (giờ máy chủ, DB `now()`), `expires_at = created_at + interval '5 minutes'` (CHECK). Mã hiệu lực khi
  `consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > now()`.
- **Xác minh** — một transaction: `SELECT … FOR UPDATE` thử thách chưa dùng, chưa hủy → **kiểm `expires_at > now()` trong lúc giữ khóa** → tính HMAC trong app → `crypto.timingSafeEqual` → khớp: `consumed_at = now()`;
  sai: `attempts + 1`, đủ 5 thì `invalidated_at`. Commit. Hết hạn/không có → lỗi trung tính.
- Đổi pepper: tăng `key_version`, đánh dấu mọi thử thách cũ `invalidated_at`.

### 5.4 Định danh, liên kết, gộp (DG §4) [G15]
| Thao tác | Quy tắc |
| --- | --- |
| Tạo tài khoản | OTP purpose signup hoặc Google lần đầu; Google chỉ nhận `email_verified = true`; email Google **không** tự gộp với tài khoản có cùng email — nếu email đã thuộc tài khoản khác thì không tạo định danh email, chỉ định danh `google_sub` |
| Đăng nhập | OTP purpose login, hoặc `google_sub` đã liên kết |
| Liên kết | phiên trong 10 phút (không thì xác minh lại) → xác minh định danh mới (OTP purpose link hoặc Google) → INSERT; vi phạm duy nhất → chặn, hướng dẫn liên hệ hỗ trợ |
| Gỡ liên kết | khóa dòng `users` → còn ≥ 2 định danh mới được gỡ |
| Gộp | quản trị (owner), xem trước, một transaction: khóa hai `users` theo id tăng dần → **chuyển định danh** (`user_identities.user_id`, không phải lịch sử) → **tạo** dòng `learning_progress` cho tài khoản đích lấy giá trị cao nhất mỗi bài → tài khoản nguồn `status = merged`, `merged_into_id = đích`, thu hồi phiên/thiết bị → audit. **Không** sửa lịch sử bất biến: `orders.user_id`, `enrollments`, `refunds`, `consents`, `learning_events` giữ nguyên tài khoản gốc. Quyền học và lịch sử đọc theo **nhóm gộp**: hàm `effective_user_ids(u)` = u + mọi tài khoản có `merged_into_id` trỏ (trực tiếp hoặc theo chuỗi) về u; kiểm quyền học dùng `enrollments.user_id IN effective_user_ids(...)`. Đồng ý tiếp thị: dùng của tài khoản đích; của nguồn vẫn lưu làm bằng chứng. **Hồ sơ** (`crew_profiles`, `training_interests`): màn xem trước so sánh hai hồ sơ; giữ hồ sơ của tài khoản đích; trường đích trống thì lấy giá trị nguồn (chỉ khi owner chọn trong xem trước); mọi khác biệt của nguồn ghi vào `admin_audit_log` (before/after); hồ sơ nguồn giữ nguyên, gắn tài khoản nguồn [G12a] |
| Tài khoản chỉ có số điện thoại | thao tác nhạy cảm chờ 24 giờ + báo các kênh khác; khôi phục qua hỗ trợ theo DG §3 [G15] |

### 5.5 Quản trị (DG §5) [G11]
- `admin_users` không DELETE (chỉ đổi status). Mọi thay đổi role/status đi qua một hàm DB `admin_change(...)`: `pg_advisory_xact_lock(ns_admin_owner)` →
  đổi → kiểm còn ≥ 1 owner active, nếu không thì lỗi. Trigger trên `admin_users` cũng lấy cùng khóa và kiểm cùng điều kiện (chặn đường vòng). Bootstrap
  (`admin:bootstrap`) dùng cùng hàm.
- Lời mời: `invited_at` NOT NULL, `invite_expires_at = invited_at + 7 ngày` (CHECK); quá hạn coi như `expired` (job cập nhật, và kiểm trực tiếp khi
  đăng nhập: `now() < invite_expires_at`). Test biên: đúng 7 ngày trừ 1 giây được, đúng 7 ngày bị từ chối. Chỉ `active`, hoặc `invited` còn
  hạn khi kích hoạt, mới đăng nhập được. Đổi role/status → xóa mọi `admin_sessions` của người đó trong cùng transaction.
- Đăng nhập quản trị: Google (`email_verified`, email khớp `email_lower`) hoặc link email.
- **Link email quản trị:** bảng `admin_email_links` (token_hash duy nhất, admin_user_id, purpose `login`, created_at, `expires_at = created_at + 15 phút`
  (CHECK), used_at). Tiêu thụ — một transaction: `UPDATE admin_email_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at >
  now() RETURNING admin_user_id` → khóa `admin_users` dòng đó → kiểm status `active`, hoặc `invited` còn hạn (→ đổi sang `active` qua `admin_change`) →
  tạo `admin_sessions` → audit → commit → mới trả cookie. Link chỉ dùng cho khu vực quản trị (token tra trong bảng riêng, không thể dùng ở luồng học viên).
  Test: dùng hai lần song song (một thành công), biên 15 phút, lời mời hết hạn, tài khoản bị thu hồi.
- Ma trận quyền là hằng trong `auth-admin`; mọi handler gọi `requirePermission(...)`; thao tác nhạy cảm cần đăng nhập lại trong 10 phút.

### 5.6 Thiết bị (DG §6) [G10]
- Sau khi OTP/Google xác thực thành công trên bản cài mới mà người dùng đã có 2 thiết bị: tạo **vé đăng nhập chờ** `login_tickets` (token 32 byte,
  DB lưu hash; gắn user, khu vực học viên, hash `device_key` ứng viên, mục đích `replace_device`; hết hạn 10 phút; dùng một lần), trả trong cookie
  `__Host-me_ticket` (HttpOnly) cùng danh sách thiết bị để chọn. Mã OTP đã bị tiêu thụ nên không dùng lại được; vé là bằng chứng duy nhất.
- Bước chọn (hoặc ngay khi chưa đủ 2 thiết bị) — một transaction: tiêu thụ vé (`UPDATE … SET used_at WHERE hash = $1 AND used_at IS NULL AND
  expires_at > now() RETURNING`) nếu có → khóa `users` `FOR UPDATE` → đếm thiết bị hiệu lực → thu hồi thiết bị được chọn và mọi phiên của nó → tạo
  `devices` → tạo phiên → commit → mới trả cookie phiên. `device_key` sinh trên máy (32 byte), DB lưu hash.

### 5.8 Hợp đồng Google OAuth (theo D1)
- Thư viện: **`openid-client`** (thư viện OpenID Connect phía máy chủ, xác minh ID token theo chuẩn).
- Luồng: Authorization Code + **PKCE S256**; `state` và `nonce` ngẫu nhiên lưu trong cookie tạm theo khu vực (10 phút, dùng một lần); `redirect_uri`
  **khớp chính xác** từng khu vực (`/api/auth/learner/google/callback`, `/api/auth/admin/google/callback`) và đã đăng ký ở Google.
- Xác minh ID token: chữ ký theo JWKS của Google, `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = client id, `exp`/`iat` hợp lệ,
  `nonce` khớp; dùng `sub` làm định danh; chỉ nhận email khi `email_verified = true`.
- Không lưu access/refresh token của Google (chỉ cần danh tính). Lỗi (người dùng hủy, `state` sai, token sai) → về trang đăng nhập với thông báo chung,
  ghi log an ninh không kèm token.

### 5.7 Test bắt buộc cho đăng nhập
Cookie hai khu vực không lẫn; phiên học viên gọi API quản trị bị 401 và ngược lại; đăng xuất một bên; OAuth callback hai khu vực; CSRF/Origin; OTP gửi và xác
minh song song; hạn mức song song; đổi pepper; lời mời hết hạn; hạ quyền hai owner cùng lúc (phải còn một); đăng ký thiết bị thứ ba song song; liên kết
`google_sub` đã thuộc người khác; gỡ định danh cuối cùng.

## 6. Offline (DG §6) [G9, G10]

- **Giấy phép:** JWS compact, `alg = EdDSA` (Ed25519), header `kid`. Claims: `v` (phiên bản định dạng), `sub` (user), `did` (device), `courses` (id + phiên bản
  nội dung), `iat`, `exp = iat + 30 ngày`, `grace = 7 ngày`. App nhúng danh sách khóa công khai theo `kid`.
- **Đổi khóa theo giai đoạn:** (1) phát hành bản app có thêm khóa công khai mới (chưa ký bằng nó); (2) mỗi lần đồng bộ, client gửi danh sách `kid` nó tin;
  máy chủ chỉ ký bằng khóa mới cho client đã có khóa mới, client cũ vẫn nhận token ký bằng khóa cũ; (3) theo dõi tỷ lệ client có khóa mới; khi không còn
  client cũ hoạt động (hoặc sau ≥ 37 ngày và đã nhắc cập nhật) thì ngừng ký bằng khóa cũ; (4) bản app sau mới bỏ khóa cũ. Khóa riêng bị lộ: thu hồi ngay,
  client cũ phải kết nối để nhận bản app mới (ghi rõ trong runbook).
- **Hiệu lực trên máy:** gọi `t = max(giờ máy, mốc lớn nhất đã lưu)`. `t < exp` → học bình thường; `exp ≤ t < exp + grace` → học bài đã tải, banner yêu cầu
  kết nối; `t ≥ exp + grace` → khóa nội dung trả phí tới khi đồng bộ. Mốc lưu trong IndexedDB có thể bị xóa → **chống chỉnh đồng hồ chỉ ở mức cố gắng**, ghi rõ
  trong chính sách; xóa dữ liệu đồng nghĩa mất bài đã tải (phải tải lại khi có mạng).
- **Tách dữ liệu theo người:** Cache Storage/IndexedDB đặt tên theo `sub` + `did`; mỗi bản cài chỉ một học viên đăng nhập; đăng xuất hoặc đổi tài khoản → xóa
  toàn bộ dữ liệu bảo vệ của người trước. Đồng bộ trả về khóa bị thu hồi → xóa dữ liệu của khóa đó.
- **Manifest và tải tệp:** `GET /api/learn/courses/:id/manifest` (kiểm quyền) → danh sách asset id, bytes, sha256, phiên bản. Tải từng tệp qua §7, kiểm sha256,
  chỉ đánh dấu xong khi đủ; tiếp tục khi đứt. Báo dung lượng trước; `navigator.storage.persist()`; phát hiện bị xóa và hướng dẫn tải lại.
- **Đồng bộ** `POST /api/learn/sync` — thiết bị lấy **từ phiên** (không tin `device_id` trong body). Mỗi sự kiện: `event_id` (UUID), `seq` (tăng dần theo thiết bị),
  `lesson_id`, `type`, `payload`, `client_time`. Một transaction mỗi lô, **mỗi sự kiện trong một savepoint** (lỗi một sự kiện không hủy cả lô); duy nhất `event_id` và `(device_id, seq)`.
  Kết quả từng sự kiện: `accepted`; `duplicate` (cùng `event_id`, nội dung y hệt); `rejected` (vĩnh viễn: cùng `event_id` nội dung khác, `seq` đã dùng cho sự
  kiện khác, dữ liệu sai định dạng, bài không tồn tại); `retryable` (lỗi tạm thời). Sự kiện `rejected` ghi vào `sync_rejections` để hỗ trợ xem; khóa học không còn quyền → lưu sự kiện với `entitlement_ok = false`, không cập nhật tiến độ; có
  quyền → cập nhật `learning_progress` theo quy tắc chỉ tăng; bài kiểm tra lưu từng lần vào `quiz_attempts`. Commit rồi mới trả **kết quả từng sự kiện** + giấy phép
  mới. Client: xóa `accepted`/`duplicate`; chuyển `rejected` sang kho cách ly trên máy (giữ để chẩn đoán, không gửi lại, có nút gửi báo lỗi); giữ `retryable`
  để gửi lần sau. Lỗi cả request (mạng, 5xx) → giữ nguyên hàng chờ.

## 7. Tệp media (DG §7)

- Công khai: Caddy phục vụ thẳng từ `media/public/` (tên theo hash, cache dài).
- Bảo vệ: **chỉ** qua `GET /api/learn/files/:assetId` trong app, không URL có chữ ký ở giai đoạn 1. Handler: phiên học viên + thiết bị → tra `media_assets` theo id
  (đường dẫn không bao giờ lấy từ client) → kiểm quyền học với khóa chứa tệp → mở tệp dưới `media/protected/`, kiểm `realpath` nằm trong thư mục gốc, không theo
  symlink → stream, hỗ trợ `Range` (206), `Content-Type` từ DB, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, giới hạn kích thước tệp (ví dụ
  100 MB); hủy đọc khi client ngắt.

## 8. Worker, outbox, job (DG §8)

- **Lease job:** bảng `job_leases` (job_name khóa chính, token uuid, generation bigint, holder, expires_at). Lấy (tạo dòng nếu chưa có):
  `INSERT … VALUES ($job, gen_random_uuid(), 1, $me, now()+2 phút) ON CONFLICT (job_name) DO UPDATE SET token = gen_random_uuid(), generation =
  job_leases.generation + 1, holder = $me, expires_at = now() + 2 phút WHERE job_leases.expires_at < now() RETURNING token, generation` — không trả dòng
  nghĩa là đang có người giữ → ghi `job_runs` status `skipped`.
- Heartbeat mỗi 30 giây: `UPDATE … SET expires_at = now() + 2 phút WHERE job_name = $1 AND token = $2` — 0 dòng → mất lease → dừng job (AbortController).
  Nhả trong `finally`: `UPDATE … SET expires_at = now() WHERE job_name = $1 AND token = $2`.
- **Chặn ghi khi mất lease (fencing):** mọi transaction có tác dụng không lặp lại được của **mọi** job (con trỏ đối soát, đánh dấu đã gửi tổng kết ngày,
  hết hạn lời mời, giải phóng thiết bị, xóa dữ liệu quá hạn, dọn media, ghi kết quả sao lưu) bắt đầu bằng `SELECT … FROM job_leases WHERE job_name = $1
  FOR UPDATE` rồi kiểm `token`, `generation` và `expires_at > now()`; sai thì rollback và dừng job. Vì lấy lease mới cũng phải `UPDATE` dòng đó, hai bên
  bị tuần tự hóa. Job chỉ làm việc lặp lại an toàn (hết hạn đơn) vẫn dùng lease nhưng không bắt buộc bước này. Worker chết → lease hết hạn → lần sau lấy
  lại với token mới. Tên job cố định, có namespace (`me.orders.expire`…).
- `job_runs`: id, job_name, started_at, finished_at, status (running/success/failed/skipped/timeout), error, stats. Trang quản trị hiển thị và có nút “chạy ngay”
  (ghi yêu cầu vào bảng `job_requests`, worker đọc — không gọi HTTP).
- **Outbox:** `outbox_events` (dedup_key duy nhất). Gửi: transaction ngắn nhận lô `(status = 'pending' AND next_attempt_at <= now()) OR (status = 'sending'
  AND claimed_until < now())` bằng `FOR UPDATE SKIP LOCKED` — tức là **lấy lại cả các tin bị bỏ dở** khi tiến trình gửi chết —, đặt `status = sending,
  claim_token = mới, claimed_until = now() + 2 phút, attempts + 1`, **commit** → gửi ra ngoài (kèm khóa chống trùng của nhà cung cấp nếu có) → `UPDATE … SET
  status = sent WHERE id = $1 AND claim_token = $2` (0 dòng = đã bị lấy lại, bỏ qua). Lỗi → `pending` với giãn cách (cũng kèm điều kiện claim_token);
  quá N lần → `dead` + cảnh báo. Test: giết tiến trình gửi giữa chừng, tin được lấy lại và gửi sau khi claim hết hạn.
  **Giới hạn đã chấp nhận:** giao hàng ít nhất một lần; nếu tiến trình chết đúng sau khi nhà cung cấp nhận mà trước khi ghi `sent` thì có thể gửi trùng một lần
  (Telegram/email). Webhook gửi lại **không** tạo tin trùng (nhờ dedup_key) — đúng invariant CLAUDE.md.

| Job | Lịch (Asia/Ho_Chi_Minh) |
| --- | --- |
| Hết hạn đơn, nhả mã giảm giá | mỗi phút |
| Đối soát SePay | mỗi giờ [G4] |
| Gửi outbox | liên tục |
| Tổng kết Telegram | 21:00 |
| Hết hạn lời mời quản trị | mỗi giờ |
| Xóa dữ liệu quá hạn lưu, ghi âm | 03:00 [G12a] |
| Giải phóng thiết bị quá hạn | 03:30 [G9, G10] |
| Kiểm tra sao lưu gần nhất | 08:00 [G8] |

- **Ghi tệp media (để sao lưu nhất quán):** ghi vào thư mục tạm **trên cùng ổ đĩa** → `fsync` → kiểm sha256 → đổi tên nguyên tử sang đường dẫn cuối →
  `fsync` thư mục → **sau đó** mới commit dòng `media_assets` trong DB. Vì vậy mọi tệp DB tham chiếu đều đã nằm ở vị trí cuối trước khi DB biết tới nó.
- **Xóa tệp media:** không xóa trực tiếp. Job dọn chỉ xử lý tệp **không còn được tham chiếu** liên tục **quá thời hạn giữ bản sao lưu** (30 ngày): lần chạy
  này **chuyển** tệp sang thư mục cách ly theo `generation` của lease; lần chạy sau (sau ≥ 1 lần sao lưu thành công) mới xóa hẳn, sau khi kiểm lại vẫn không
  được tham chiếu.
- **Độc quyền cho tác dụng ngoài DB** (sao lưu, dọn media — chạy tiến trình con `pg_dump`, mã hóa, tải lên, xóa tệp): ngoài lease, mỗi lần chạy giữ **khóa tệp trên máy** (`flock` độc quyền trên `/data/locks/media-backup.lock`) và mở tiến trình con **kế thừa
  bộ mô tả tệp đang giữ khóa**, nên khóa chỉ được nhả khi **cả** worker **và** tiến trình con đã thoát — mất kết nối DB không làm nhả khóa. (Một VPS duy nhất nên
  khóa tệp là đủ; container worker cũ và mới dùng chung volume `/data/locks`.) Sao lưu và dọn media dùng chung khóa này nên không bao giờ chạy chồng. Mất
  lease hoặc mất kết nối DB → SIGTERM rồi SIGKILL sau 10 giây cho tiến trình con, bỏ kết quả dở; worker mới chờ khóa tệp (không chờ quá thời hạn job, khi đó
  ghi `skipped`). Kết quả ghi theo `generation`: bản sao lưu tải lên với tên chứa generation; chỉ khi transaction có fencing (§8) thành công mới đánh dấu bản đó
  là “mới nhất”. Test: hai worker chồng lên nhau sau khi lease hết hạn — chỉ một bên chạy; cắt kết nối DB của worker cũ khi tiến trình con còn chạy → worker mới vẫn bị
  chặn ở khóa tệp cho tới khi tiến trình con thoát.
- **Sao lưu [G8]:** `pg_dump` (định dạng custom) trước, rồi đồng bộ `media/` — nhờ hai quy tắc trên, mọi tệp bản dump tham chiếu đều đã có khi chép; tệp mới
  hơn dump thì thừa, không gây lỗi. Mã hóa phía máy trước khi đẩy; giữ DB 30 bản hằng ngày, media theo kiểu tăng dần; ghi kết quả vào DB; thử khôi phục trên
  máy khác trước ra mắt và mỗi quý (bằng chứng: ảnh/ghi chép, thời gian khôi phục).

### 8.1 Nhật ký quản trị bắt buộc
Mọi lệnh có đặc quyền ghi `admin_audit_log` **cả khi thành công lẫn khi bị từ chối** (thiếu quyền, sai trạng thái, vi phạm ràng buộc), trong cùng transaction với
thay đổi (lần bị từ chối ghi bằng transaction riêng sau khi rollback). Danh sách: ghép tay mọi loại, nhập và xác minh sao kê, đánh dấu trùng/bỏ qua, cấp không thu
tiền, **mọi bước chuyển của refund** và điều chỉnh, đổi giá khóa học, tạo/sửa/tắt mã giảm giá, gộp tài khoản, gỡ thiết bị hộ học viên, xử lý yêu cầu dữ liệu,
xuất dữ liệu, mời/kích hoạt/đổi vai trò/thu hồi quản trị, bootstrap và khôi phục khẩn cấp, chạy job bằng tay. Mỗi dòng có: người làm, hành động, đối tượng,
giá trị trước/sau, kết quả, lý do, bằng chứng, IP, thời điểm.

## 9. Kiểm thử — ma trận yêu cầu → test

| Yêu cầu (DG/CLAUDE.md) | Test |
| --- | --- |
| Giá từ máy chủ, ảnh chụp bất biến | unit tạo đơn; integration UPDATE cột bất biến bị chặn |
| Chuyển trạng thái đơn hợp lệ | integration mọi cặp trạng thái, cặp không hợp lệ bị trigger chặn |
| Chống trùng giao dịch | webhook gửi lại; hai webhook cùng giao dịch song song; nhập tay rồi SePay báo (khớp / lệch) |
| Tự xác nhận đúng điều kiện | bảng phân loại đầy đủ; biên `= created_at`, `= expires_at`; thời gian tương lai |
| Đơn hết hạn → đã thanh toán | job hết hạn chạy trước webhook muộn |
| Loại trừ phân bổ/kết luận | ghép tay và đánh dấu bỏ qua song song trên cùng dòng sổ |
| Chuyển bù, thừa tiền | tổng đúng/thiếu/thừa; refund excess tạo cùng transaction |
| Hoàn tiền | full thu hồi đúng quyền học; refund full khác `amount_due_vnd` → bị từ chối; refund excess khi đơn không có tiền thừa → bị từ chối; reversal rồi tạo refund mới trên cùng dòng sổ → được; UPDATE/DELETE `payment_allocations` khi đã có refund phụ thuộc → bị chặn; excess không đổi đơn; hai refund full song song; gắn nguồn là giao dịch đã phân bổ cho đơn khác → bị từ chối |
| Không deadlock | ghép tay và webhook song song theo thứ tự khóa |
| Xác minh tay tách người | người nhập tự xác minh bị chặn |
| Mã giảm giá | giữ chỗ, nhả sau 45 phút, vượt hạn mức khi thanh toán muộn |
| Outbox | không gửi trùng khi webhook lặp; worker chết khi đang gửi (claim hết hạn) |
| OTP | xem §5.7; mã không xuất hiện trong DB/log (tìm chuỗi) |
| Phiên hai khu vực | xem §5.7 |
| Thiết bị | thiết bị thứ ba song song; thu hồi → phiên hết hiệu lực |
| Offline | token sửa chữ ký/`kid` lạ bị từ chối; biên `exp`, `exp+grace`; chỉnh đồng hồ lùi; hai học viên trên một máy; khóa bị thu hồi xóa dữ liệu |
| Đồng bộ | lô lặp lại; `event_id` trùng nội dung khác; `seq` trùng; khóa hết quyền; **lô hỗn hợp** (accepted + duplicate + rejected + retryable trong cùng lô: chỉ sự kiện lỗi bị loại, phần còn lại vào DB); sự kiện sai định dạng, bài không tồn tại; lỗi tạm thời một sự kiện; commit lỗi / 5xx → client giữ nguyên hàng chờ; client: chỉ xóa accepted/duplicate, rejected vào kho cách ly và nút báo lỗi gửi được |
| Media bảo vệ | không phiên/không quyền → 401/403; Range; đường dẫn lạ; symlink |
| Lease job | hai worker cùng lấy; worker chết lấy lại; mất lease dừng job |
| Sao lưu | khôi phục toàn bộ trên máy khác (diễn tập); job dọn media không chạy cùng sao lưu |
| Ingest | giao dịch SePay mới được xác minh ngay; nhập tay rồi SePay báo khớp chính xác / lệch 1 giây; thiếu mã tham chiếu hoặc thời điểm → hàng chờ thiếu dữ kiện |
| Xác minh tay | khóa dòng sổ trước; người nhập tự xác minh bị chặn |
| Thừa tiền nhiều dòng | `refund_sources` đúng quy tắc, tổng khớp |
| Điều chỉnh refund | reversal không đổi đơn/quyền học; hai điều chỉnh song song dùng **nguồn khác nhau** của cùng một refund; hai refund excess song song của cùng một đơn từ nguồn khác nhau (tổng không vượt tiền thừa); dấu của delta (reversal âm, correction âm/dương); biên 0 và tối đa bằng số tiền dòng sổ; nguồn không thuộc refund bị từ chối; hai điều chỉnh song song trên cùng dòng sổ; refund failed/cancelled không tính; trigger hoãn từ chối khi tổng sai; UPDATE/DELETE dòng nguồn bị chặn |
| Phiên học viên | hết hạn tuyệt đối/nhàn rỗi; xoay token; thiết bị bị thu hồi |
| Vé đăng nhập | dùng lại, hết hạn, sai khu vực bị từ chối |
| Gộp tài khoản | quyền học và lịch sử đọc theo nhóm gộp; không UPDATE bảng bất biến |
| Google OAuth | `state`/`nonce` sai, `aud`/`iss` sai, `email_verified = false` |
| Đổi khóa offline | client cũ vẫn nhận token khóa cũ; client mới nhận khóa mới |
| Quyền tệp | tệp dùng lại ở hai khóa; bài học thử; tệp không thuộc khóa nào |
| Lease job | lease mất giữa chừng → lần ghi có fencing bị từ chối |
| Webhook hạn chót | khóa bị giữ lâu → 503 trước 8 giây |
| Nhật ký quản trị | mỗi lệnh ở §8.1 ghi cả thành công và bị từ chối |

## 10. Còn mở

- D1 — đã duyệt (tự quản lý phiên).
- Hợp đồng chữ ký SePay, trường thời gian, mã tham chiếu, API đối soát — G4.
- Bảng ký tự mã đơn và quy tắc nhận diện SePay — G5.
- Thư viện lập lịch trong worker, hệ thành phần giao diện — chọn ở bước dựng khung, không ảnh hưởng thiết kế dữ liệu.
- Cấu trúc nội dung bài, FR/NFR còn thiếu — G1.

## Phụ lục A — ràng buộc chính

| Bảng | Ràng buộc |
| --- | --- |
| `users` | `status IN ('active','disabled','merged')`; `merged_into_id` NOT NULL ⇔ status = merged; FK `merged_into_id → users`; không cho vòng gộp (trigger) |
| `user_identities` | FK `user_id → users` RESTRICT; `kind IN ('phone','email','google')`; duy nhất `(kind, value_canonical)`; kind=phone ⇒ `value_canonical ~ '^\+84[0-9]{9}$'`; kind=google ⇒ value_canonical = google_sub |
| `otp_challenges` | `purpose IN ('signup','login','link')`; `expires_at = created_at + interval '5 minutes'`; `attempts BETWEEN 0 AND 5`; duy nhất một phần `(purpose, value_canonical) WHERE consumed_at IS NULL AND invalidated_at IS NULL` |
| `learner_sessions` | FK `user_id`, `device_id`; token_hash duy nhất |
| `devices` | FK `user_id`; device_key_hash duy nhất |
| `admin_users` | duy nhất `email_lower`; `role IN ('owner','support')`; `status IN ('invited','active','expired','revoked')`; `invited_at` NOT NULL; `invite_expires_at = invited_at + interval '7 days'`; không DELETE (quyền DB + trigger) |
| `admin_audit_log` | FK `admin_user_id`; không UPDATE/DELETE |
| `orders` | duy nhất `code`; FK `user_id`; §3.5 |
| `order_items` | FK `order_id`, `course_id`; `final_price >= 0`; không UPDATE/DELETE |
| `coupon_reservations` | FK `order_id` (duy nhất), `coupon_id`; `consumed_at` và `released_at` không cùng NOT NULL |
| `bank_transactions` | §4.1; không UPDATE/DELETE |
| `bank_transaction_observations` / `_verifications` / `_classifications` | FK `bank_transaction_id` (NULL được cho observation thiếu dữ kiện, khi đó `unresolved_reason` NOT NULL); chỉ thêm; verification method owner ⇒ `verified_by` NOT NULL và ≠ `entered_by` của dòng sổ |
| `refund_sources` | FK `refund_id`, `bank_transaction_id`; `amount_vnd > 0`; constraint trigger hoãn: `bank_transaction_id` phải có `payment_allocations` tới **cùng đơn** với refund; tổng theo refund = `refunds.amount_vnd`; **số hoàn hiệu lực** theo dòng sổ (nguồn + điều chỉnh, refund chưa failed/cancelled) ≤ số tiền dòng sổ; full = `amount_due_vnd`; excess cộng dồn ≤ số tiền thừa thực tế (constraint trigger hoãn, sau khi đã khóa dòng sổ) |
| `refund_adjustments` | FK `refund_id`; `kind IN ('reversal','amount_correction')`; chỉ thêm |
| `login_tickets` | token_hash duy nhất; FK `user_id`; `expires_at`; `used_at` |
| `bank_transaction_observations` (bổ sung) | duy nhất `resolves_observation_id` khi có; duy nhất `(source, provider_event_id)` khi có |
| `learner_sessions` (bổ sung) | `prev_valid_until` và `next_token_enc` cùng NULL hoặc cùng có |
| `session_token_history` | FK `session_id`; `token_hash` duy nhất; `detect_until` NOT NULL; chỉ thêm (job dọn xóa dòng quá hạn) |
| `admin_email_links` | token_hash duy nhất; FK `admin_user_id`; `purpose = 'login'`; `expires_at = created_at + interval '15 minutes'`; không DELETE |
| `refund_adjustment_sources` | FK `adjustment_id`, `bank_transaction_id`; duy nhất cặp; không UPDATE/DELETE; constraint trigger hoãn: `bank_transaction_id` phải là một nguồn trong `refund_sources` của chính refund cha (và vì vậy đã phân bổ cho đơn của refund đó); tổng theo điều chỉnh = `refund_adjustments.amount_delta_vnd`; ràng buộc hiệu lực §4.6 (constraint trigger hoãn) |
| `bank_transaction_observations` (tự tham chiếu) | `resolves_observation_id` FK tới chính bảng; trigger: đích phải có `bank_transaction_id IS NULL` và `unresolved_reason` NOT NULL; observation giải quyết phải có `bank_transaction_id` NOT NULL và `source = 'manual'`; không tự trỏ; duy nhất |
| `sync_rejections` | FK `device_id`, `user_id`; `event_id`, lý do, dữ liệu gốc; chỉ thêm |
| `lesson_version_assets` | FK `lesson_version_id`, `media_asset_id`; duy nhất cặp |
| `job_leases` | `job_name` khóa chính; `token` NOT NULL; `generation >= 1` |
| `payment_allocations` | FK `bank_transaction_id` (duy nhất), `order_id`; `amount_vnd > 0`; **bất biến**: không UPDATE, không DELETE (trigger + quyền DB) — vì refund và trạng thái đơn dựa vào nó; constraint trigger: không có kết luận hiệu lực cho cùng dòng sổ |
| `bank_transaction_dispositions` | FK `bank_transaction_id`; `kind IN ('duplicate','ignored')`; reason NOT NULL; duy nhất một phần `WHERE superseded_at IS NULL`; constraint trigger: không có phân bổ |
| `refunds` | FK `order_id` (không có FK tới dòng sổ — nguồn ở `refund_sources`); `kind IN ('full','excess')`; `amount_vnd > 0`; trigger chuyển trạng thái; duy nhất `out_bank_ref`; duy nhất một phần `(order_id) WHERE kind='full' AND status NOT IN ('failed','cancelled')` |
| `enrollments` | FK `user_id`, `course_id`; `source IN ('order','grant')`; source=order ⇔ `order_id` NOT NULL AND `grant_reason` IS NULL; source=grant ⇔ `order_id` IS NULL AND `grant_reason` NOT NULL AND `granted_by` NOT NULL; duy nhất `(order_id, course_id)` |
| `learning_events` | duy nhất `event_id`; duy nhất `(device_id, seq)`; FK `user_id`, `device_id`; không UPDATE |
| `outbox_events` | duy nhất `dedup_key`; `status IN ('pending','sending','sent','failed','dead')` |
| `job_leases`, `job_runs`, `reconciliation_cursors` | khóa chính theo tên/khóa tự nhiên; `job_runs.status` CHECK |
