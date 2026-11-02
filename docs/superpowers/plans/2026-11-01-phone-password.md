# Đăng nhập học viên bằng số điện thoại + mật khẩu — kế hoạch

> For agentic workers: thực hiện theo superpowers:executing-plans, TDD từng task, Postgres thật.

**Goal:** Học viên tạo tài khoản và đăng nhập bằng số điện thoại + mật khẩu, bên cạnh email và Google.

**Quyết định của chủ dự án (01/11/2026):**
- Thêm, không thay: giữ đăng nhập bằng mã email và Google; số điện thoại + mật khẩu là cách chính trên màn đăng nhập.
- Số điện thoại **chưa xác minh** khi đăng ký (chưa có SMS; mã Zalo chờ G6). Xác minh để sau.
- Quên mật khẩu: qua email đã liên kết; hỗ trợ đặt lại tay; qua mã Zalo khi có G6 (chưa làm ở kế hoạch này).
  Đặt lại tay theo G15 (“chủ duyệt, có nhật ký”): chỉ **chủ** làm, bắt buộc lý do và bằng chứng (mã đơn, mã giao dịch hoặc thông tin hồ sơ).
- Quản trị viên không đổi: vẫn Google hoặc link email, không mật khẩu.

**Architecture:** Bảng mới `password_logins` (một dòng mỗi học viên): số điện thoại dạng `+84…` duy nhất, băm mật khẩu, `phone_verified_at` để trống. Không ghi vào `user_identities`, vì bảng đó chỉ chứa danh tính đã xác minh (mã Zalo sau này đăng nhập theo bảng đó, không được rơi vào tài khoản của người chiếm số trước). Băm bằng `scrypt` có sẵn trong Node (không thêm thư viện). Đăng nhập xong đi qua `completeLearnerAuth` như các cách khác (giới hạn 2 máy giữ nguyên).

**Tech:** Next.js 16 route handlers, Prisma raw SQL, Postgres 16, Vitest.

## Quy tắc

- Chuẩn hóa số: `canonicalizeVnPhone` chạy trước mọi tra cứu, kiểm chính sách, khóa và đếm lượt; số không hợp lệ: đăng nhập trả `invalid` (vẫn đếm theo IP), đăng ký trả 400.
- Thứ tự khóa (mọi đường: đăng ký, đăng nhập, kiểm mật khẩu hiện tại, thêm số + mật khẩu, liên kết số đã xác minh): khóa tư vấn theo IP
  (`pw-ip:<ip>`) rồi theo số (`phone:<+84…>`), trong cùng transaction với việc đếm và ghi lượt thử. Liên kết số đã xác minh (link/Zalo sau này)
  cũng lấy khóa `phone:` và kiểm cả `password_logins`; đăng ký và thêm mật khẩu kiểm cả `user_identities` loại phone. Ưu tiên **lệch**:
  số đã xác minh thắng. Số đã xác minh chặn đăng ký mới (`phone_taken`, kể cả khi là số của chính người đó, vì đăng ký tạo tài khoản mới) và
  chặn thêm mật khẩu / chủ gắn số mới khi số đó đã xác minh cho **học viên khác**. Học viên đã đăng nhập thêm mật khẩu cho số **chính mình** đã
  xác minh thì được, và dòng mới ghi `phone_verified_at` ngay (test: cùng chủ thành công, khác chủ bị từ chối). Ngược lại, dòng
  `password_logins` chưa xác minh **không** chặn và **không** nhận danh tính đã xác minh: khi một học viên khác xác minh số đó (liên kết số,
  đăng nhập/đăng ký bằng mã Zalo sau G6), trong cùng transaction dòng `password_logins` của người kia bị nhả (`released_at = now()`, đăng nhập
  bằng mật khẩu với số đó trả `invalid`, học viên đó nhờ hỗ trợ). Cùng học viên xác minh số của chính mình → ghi `phone_verified_at`.
  Vòng đời dòng bị nhả: dòng nhả **không** giữ chỗ — mỗi học viên một dòng (`user_id` là khóa chính), nhả thì dòng đó coi như trống;
  gắn số mới cập nhật chính dòng đó (số mới, mật khẩu mới, `released_at = NULL`, `phone_verified_at` theo danh tính đã xác minh của chính
  học viên), số cũ và lúc nhả ghi vào `admin_audit_log` (che số) hoặc nhật ký học viên. Hai đường gắn số mới: (a) học viên đăng nhập bằng
  email/Google rồi “thêm số + mật khẩu” ở Tài khoản của tôi (cho phép khi chưa có dòng hoặc dòng đã nhả); (b) chủ khôi phục theo G15 ở
  trang học viên: `POST /api/quan-tri/learners/[id]/password { reason, evidence, phone? }` — kèm `phone` thì gắn số mới chưa ai dùng
  (không trùng dòng chưa nhả của người khác, không trùng số đã xác minh của người khác) và đặt mật khẩu tạm.
  Hàm dùng chung `claimVerifiedPhone(tx, userId, phone)` gọi ở mọi chỗ tạo danh tính phone đã xác minh. Hai đăng ký bằng mật khẩu cùng số:
  ai commit trước thắng, bên sau `phone_taken`.
- Băm: `scrypt` N=2^15, r=8, p=1, `maxmem` 64 MB (N=2^15 cần 32 MB, vượt mặc định của Node), muối 16 byte, khóa 32 byte; lưu `scrypt$15$8$1$<muối b64>$<băm b64>`; so bằng `timingSafeEqual`. Số không có tài khoản vẫn băm một lần với muối giả để thời gian trả lời như nhau.
- Mật khẩu: 8–128 ký tự, không trùng các chữ số của chính số điện thoại, không nằm trong danh sách ngắn mật khẩu phổ biến (`12345678`, `123456789`, `password`, `matkhau123`, `11111111`, `00000000`, `88888888`, `abc12345`, `qwerty123`). Không bắt buộc ký tự đặc biệt.
- Chặn đoán mật khẩu: mọi lần kiểm mật khẩu (đăng nhập, kiểm mật khẩu hiện tại) ghi một dòng `password_attempts` (ip, số, đúng/sai, lúc).
  Một số có từ 5 lần sai trong 15 phút gần nhất kể từ lần đúng cuối → `locked` cho tới khi lần sai thứ 5 quá 15 phút; tính theo bảng lượt thử,
  **không** theo dòng tài khoản, nên số không tồn tại bị khóa y hệt (không lộ có tài khoản). Mỗi IP: 20 lần sai trong 15 phút → `locked`.
  Đăng ký: mỗi IP tối đa 5 lần đăng ký thành công mỗi giờ (ghi vào cùng bảng, loại `register`). Khi đang khóa thì không kiểm mật khẩu.
- Trả lời đăng nhập sai luôn `{ next: "invalid" }`, đang khóa `{ next: "locked" }`, như nhau cho số có và không có tài khoản.
- `password_attempts` giữ 30 ngày (dữ liệu an ninh, như `otp_send_log`); job `me.auth.prune-password-attempts` xóa dòng cũ hằng ngày. Đăng ký với số đã có tài khoản (bảng mới hoặc `user_identities` loại phone) trả `{ error: "phone_taken" }`: không tránh được việc lộ khi đăng ký, giới hạn theo IP ở trên.
- Đổi hay đặt lại mật khẩu (tự đổi, qua email, chủ đặt tạm, thêm số + mật khẩu) → trong cùng transaction thu hồi mọi phiên khác của học viên,
  **mọi vé thay máy chưa dùng** (`login_tickets`) và **mọi mã đặt lại còn hiệu lực** (`otp_challenges` purpose `reset` của học viên đó,
  trừ mã vừa dùng: `invalidated_at = now()`).
- Đặt lại qua email: đích là email đã xác minh có `verified_at` mới nhất của học viên (bằng nhau thì id nhỏ hơn). Thử thách `otp_challenges`
  ghi `purpose = reset`, `kind = email`, `value_canonical = email đó`, `user_id`; bước xác nhận chọn lại đúng email theo cùng quy tắc và
  `verifyOtp` với đúng bộ đó, nên mã chỉ dùng được cho đúng học viên và đúng email. Phản hồi không hiện email (chỉ “nếu có email liên kết…”).
- `must_change` (sau khi hỗ trợ đặt mật khẩu tạm): đăng nhập đúng mật khẩu tạm mà không kèm `newPassword` → `{ next: "set_password" }`, **không** tạo phiên; gửi lại kèm `newPassword` hợp lệ → đổi mật khẩu, bỏ cờ, tạo phiên.
- Gộp tài khoản: `password_logins` của tài khoản nguồn chuyển sang đích nếu đích chưa có; nếu cả hai đều có thì từ chối gộp với lý do `password_conflict` (quản trị xử lý tay trước). Dòng chuyển sang mà số trùng số đã xác minh của đích → ghi `phone_verified_at`. Dòng đã nhả của nguồn **không** chuyển và không tính là “có” (đích chưa có dòng chưa nhả thì gộp bình thường; dòng nhả ở lại tài khoản nguồn đã gộp). Đích chỉ có dòng nhả, nguồn có dòng chưa nhả → dòng của nguồn thay vào chỗ của đích (dòng nhả của đích ghi nhật ký rồi bị thay).
- Không ghi mật khẩu, mật khẩu tạm hay băm vào nhật ký, outbox hay log.

## Tasks

### Task 0: Ghi quyết định vào sổ cổng (trước mọi schema và route)
- `docs/design-gates-2026-10-30.md`: thêm quyết định 01/11 (đăng nhập số + mật khẩu, số chưa xác minh, cách đặt lại); G6 thu hẹp còn
  “mã Zalo”; ghi rằng G15 (rủi ro số bị cấp lại khi đăng nhập bằng mã gửi tới số) không áp cho đăng nhập bằng mật khẩu vì người nhận lại số
  không có mật khẩu, còn tiêu chí khôi phục qua hỗ trợ của G15 được dùng nguyên cho đặt lại tay; G12a: `password_attempts` giữ 30 ngày như
  `otp_send_log`. Cập nhật `CLAUDE.md` mục Auth cùng lúc.

### Task 1: Bảng và băm mật khẩu
- Migration `password_logins` (`user_id` PK FK users, `phone_canonical` CHECK `^\+84[35789][0-9]{8}$`, duy nhất giữa các dòng chưa nhả (`UNIQUE … WHERE released_at IS NULL`), `password_hash` NOT NULL, `phone_verified_at` NULL, `released_at` NULL, `must_change` bool, `created_at`, `updated_at`); `password_attempts` (`ip` inet, `phone_canonical` NULL, `kind` check `login|current|register`, `ok` bool, `at`), index (phone, at) và (ip, at); `otp_challenges_purpose_check` thêm `reset`, ràng buộc `link_user_check` đổi thành `(purpose IN ('link','reset')) = (user_id IS NOT NULL)`; quyền `me_app` SELECT/INSERT/UPDATE.
- `src/modules/auth-learner/password.ts`: `hashPassword(pw): Promise<string>`, `verifyPassword(pw, stored): Promise<boolean>`, `passwordProblem(pw, phone): "too_short" | "too_long" | "common" | "phone" | null`.
- Test đơn vị: băm khác nhau mỗi lần, đúng/sai, định dạng chuỗi (đúng tham số production trên Node 24), các lỗi chính sách.

### Task 2: Đăng ký và đăng nhập
- `registerWithPassword(tx, { phone, password, displayName, rank, ip })` và `loginWithPassword(tx, { phone, password, newPassword?, ip })` trong `password.ts`; khóa tư vấn theo số trong transaction.
- Routes: `POST /api/auth/learner/password/register`, `POST /api/auth/learner/password/login` (cùng kiểu với `otp/verify`: same-origin, `deviceKey`, `deviceLabel`, trả `done` / `choose_device` / `invalid` / `locked` / `set_password`).
- Test tích hợp: đăng ký → phiên; các cách viết số (`0912…`, `+84912…`, `84 912 …`) là cùng một số; số đã có (bảng mới hoặc phone đã xác minh) → `phone_taken`; đăng nhập đúng/sai; khóa sau 5 lần, mở sau 15 phút, **cùng chuỗi kết quả cho số có và không có tài khoản**; giới hạn IP; giới hạn 2 máy vẫn áp; tài khoản bị khóa/gộp → invalid; `must_change`; **song song**: 2 đăng ký cùng số → một thắng; 25 lần sai song song từ một IP không vượt hạn mức; số đã xác minh của người khác chặn đăng ký; `claimVerifiedPhone` của học viên khác nhả dòng chưa xác minh (đăng nhập mật khẩu sau đó `invalid`), của chính học viên thì ghi `phone_verified_at`; chạy song song đăng ký mật khẩu và xác minh số → không bao giờ còn dòng chưa nhả của người khác cùng số với danh tính đã xác minh.

### Task 3: Quên mật khẩu qua email đã liên kết
- `POST /api/auth/learner/password/reset/send { phone }` → nếu học viên có email đã xác minh thì `issueOtp(purpose "reset", kind email, userId)`; luôn trả `{ ok: true }`.
- `POST /api/auth/learner/password/reset/verify { phone, code, newPassword, deviceKey, deviceLabel }` → `verifyOtp` (purpose reset, đúng user), đặt mật khẩu, xóa khóa, thu hồi phiên cũ, rồi `completeLearnerAuth`.
- Test: có email → mã tới hộp thư giả, đặt lại được, phiên cũ và vé thay máy cũ mất; không có email → không gửi gì, trả như nhau; mã sai/hết hạn; mã của học viên khác không dùng được; học viên có hai email → gửi tới email xác minh mới nhất, mã gửi tới email kia không dùng được; phát mã đặt lại rồi tự đổi mật khẩu, hoặc chủ đặt mật khẩu tạm → mã cũ không dùng được nữa.

### Task 4: Tài khoản của tôi và hỗ trợ đặt lại
- `POST /api/me/password { currentPassword?, newPassword, phone? }`: có dòng chưa nhả thì cần mật khẩu hiện tại, kiểm qua cùng bảng lượt thử và cùng khóa như đăng nhập (loại `current`); chưa có dòng hoặc dòng đã nhả (tài khoản email/Google) thì thêm số + mật khẩu theo thứ tự khóa chung, cần phiên vừa xác thực (`isRecentAuth`). Thu hồi các phiên khác và vé thay máy.
- Quản trị: quyền mới `learners.password_reset` (**chỉ chủ**, cần xác thực lại gần đây — G15 “chủ duyệt”); `POST /api/quan-tri/learners/[id]/password { reason, evidence }` (cả hai bắt buộc) sinh mật khẩu tạm 10 ký tự (không ký tự dễ nhầm), đặt `must_change`, thu hồi phiên và vé thay máy của học viên, ghi `admin_audit_log` kèm lý do và bằng chứng (không ghi mật khẩu), trả mật khẩu tạm một lần. Không kèm `phone` mà học viên không có dòng chưa nhả → 409 `no_password_login`; kèm `phone` → gắn số mới như mục vòng đời ở trên. Test: nhả → chủ gắn số mới → học viên vào được bằng số mới; nhả → học viên vào bằng email rồi tự thêm số mới; gộp với nguồn có dòng nhả; gộp với đích chỉ có dòng nhả.
- Tìm học viên theo số điện thoại tìm cả trong `password_logins`; trang học viên hiện số (theo quyền xem số hiện có) và trạng thái “chưa xác minh”.
- Gộp tài khoản theo quy tắc ở trên.
- Test cho từng route và quyền.

### Task 5: Giao diện
- `/dang-nhap`: mặc định thẻ “Số điện thoại” (đăng nhập / tạo tài khoản / quên mật khẩu), thẻ “Email”, nút Google; nói rõ quên mật khẩu cần email đã liên kết hoặc nhắn hỗ trợ.
- “Tài khoản của tôi”: đổi mật khẩu, hoặc thêm số + mật khẩu.
- Quản trị trang học viên: nút “Đặt mật khẩu tạm”, hiện mật khẩu tạm một lần.
- Kiểm trên trình duyệt thật (`tests/e2e-ui/`): tạo tài khoản bằng số, đăng xuất, đăng nhập lại, sai 5 lần bị khóa; đặt lại qua email; 360px không tràn.

### Task 6: Dọn dữ liệu và tài liệu
- Job `me.auth.prune-password-attempts` (hằng ngày, xóa dòng quá 30 ngày) trong `src/modules/jobs/definitions.ts`, có test.
- `docs/session-handoff.md`, `docs/ba-sua-nhom-a-2026-11-01.md` (FR-01: thêm số + mật khẩu), `docs/runbook.md` (đặt mật khẩu tạm).

## Review Focus

- Số chưa xác minh không bao giờ được coi như danh tính đã xác minh (Zalo sau này, liên kết, gộp).
- Đoán mật khẩu: khóa theo số và theo IP không bị lách bằng số không tồn tại hay đổi chữ hoa/định dạng số.
- Mật khẩu tạm và băm không lọt vào nhật ký, outbox, phản hồi lỗi.
- Đặt lại qua email chỉ đúng học viên sở hữu số; thu hồi phiên cũ.
- Đăng nhập bằng mật khẩu vẫn qua giới hạn 2 máy.

## Trạng thái (02/11/2026)

Xong cả 6 task: `21ecbce` (Task 0–2), `ce0ea84` (Task 3–4), `aeee94d` (Task 5, giao diện), Task 6 (job dọn + tài liệu) ở commit sau đó. Task 0–5 qua Codex APPROVE trước khi commit; Task 6 (`f89b515`) commit khi Codex hết lượt, review bù 02/11 đồng thuận (gợi ý thêm index trên `password_attempts(at)`).
