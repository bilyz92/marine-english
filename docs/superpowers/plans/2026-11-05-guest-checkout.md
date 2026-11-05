# Mua khóa không cần đăng nhập trước — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách chưa có tài khoản bấm "Mua khóa" là mua được: điền họ tên và số điện thoại ở trang mua, hệ thống tự tạo tài khoản kèm mật khẩu do hệ thống cấp (hiện một lần), rồi sang thanh toán; số đã có tài khoản thì hỏi mật khẩu và mua tiếp trên cùng trang.

**Architecture:** Thêm một API đăng ký nhanh (`/api/auth/learner/password/quick-register`) dùng lại `registerWithPassword` (giới hạn theo IP, khóa theo số, băm ngoài khóa) nhưng tự sinh mật khẩu; trang `/mua/[slug]` thành trang công khai, hiện form khách khi chưa đăng nhập, dùng lại API đăng nhập số + mật khẩu và API tạo đơn sẵn có. Không đổi bảng dữ liệu.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres (raw SQL qua Prisma), Vitest, e2e Chrome không giao diện (`tests/e2e-ui`).

**Spec:** Quyết định của chủ (chat 05/11/2026): (1) khách chưa có tài khoản vẫn mua được; ở bước thông tin điền thông tin cơ bản, hệ thống tự tạo tài khoản; (2) chọn "Tên + SĐT, hệ thống tự cấp mật khẩu"; (3) số điện thoại hoặc email đã có tài khoản → "Hỏi mật khẩu rồi mua tiếp". Ràng buộc nền: CLAUDE.md (D2 số + mật khẩu, `password_logins`, giới hạn 2 máy), `docs/design-gates-2026-10-30.md`.

## Global Constraints

- Không thu tiền khác đi: đơn vẫn tạo qua `POST /api/me/orders` (giá từ máy chủ, đồng ý điều khoản bắt buộc).
- Số điện thoại lưu dạng chuẩn `+84…` (`canonicalizeVnPhone`), chưa xác minh, trong `password_logins` — không vào `user_identities`.
- Mật khẩu tự cấp: 10 ký tự từ `TEMP_ALPHABET` (cùng bộ chữ với mật khẩu tạm của chủ), `must_change = false`; chỉ trả về đúng một lần trong phản hồi đăng ký nhanh; không ghi log, không lưu dạng rõ, không đưa vào URL. Mọi phản hồi của API đăng ký nhanh có `Cache-Control: no-store, private`.
- Không tiết lộ số đã có tài khoản hay chưa cho người ngoài hơn mức trang đăng ký hiện tại đã làm (`phone_taken` đã có sẵn ở `/api/auth/learner/password/register`); dùng chung hạn mức đăng ký theo IP (`REGISTRATIONS_PER_IP_HOUR`).
- Giới hạn 2 máy giữ nguyên: đăng nhập có thể trả `choose_device`.
- Chữ trên giao diện tiếng Việt, ngắn; nút bấm ≥ 44 px; không tràn ở 360 px.

## Rulings (quyết định khi spec chưa nói)

- **Email: ô không bắt buộc, chỉ dùng để nhận ra tài khoản đã có.** Chủ yêu cầu "dựa vào số điện thoại và email". Email chỉ được ghi vào tài khoản khi đã xác minh (`user_identities` chỉ chứa định danh đã xác minh) và hệ thống chưa gửi email được (chờ Gmail), nên **tài khoản mới không lưu email** ở bản này. Nếu email khách nhập trùng một email đã xác minh của tài khoản khác → `409 email_taken`; trang báo "Email này đã có tài khoản" kèm nút "Đăng nhập bằng email" (về `/dang-nhap?next=/mua/<slug>`, chọn sẵn thẻ Email) — tài khoản email/Google không có mật khẩu để hỏi tại chỗ. Chi phí nếu sai: thêm bước xác minh mã email khi Gmail chạy.
- **Số đã có tài khoản — mọi trường hợp đều đi tiếp được:**
  - Tài khoản có mật khẩu: nhập mật khẩu ngay trên trang mua.
  - Mật khẩu tạm của chủ (`must_change`): API đăng nhập trả `set_password` → trang mua hiện thêm ô "Mật khẩu mới" và gửi lại đăng nhập kèm `newPassword` (API đã hỗ trợ), xong mua tiếp — không rời trang.
  - Số đã xác minh nhưng tài khoản chưa có mật khẩu (đăng nhập bằng Zalo/email/Google): đăng nhập bằng mật khẩu luôn trả `invalid` (giữ nguyên, không lộ loại tài khoản). Khung "Số này đã có tài khoản" vì vậy luôn có thêm nút "Đăng nhập cách khác" (về `/dang-nhap?next=/mua/<slug>`); đăng nhập xong quay lại đúng trang mua và mua tiếp.

- **Tài khoản không có mật khẩu (email, Google, số đã xác minh qua Zalo) — đường đi luôn dùng được:** ở production hiện tại cả ba cách này đều tắt (Google chưa có Client ID, email chưa có nhà cung cấp, Zalo chưa bật), nên mọi tài khoản đang có đều là số + mật khẩu; trường hợp này chưa xảy ra được. Khi một cách được bật, chính cách đó đăng nhập được và nút "Đăng nhập cách khác"/"Đăng nhập bằng email" đưa khách về trang đăng nhập với `next=/mua/<slug>` để mua tiếp (luồng `next` đã có kiểm e2e trong `purchase.mjs`). Đường cứu luôn có, kể cả khi mọi nhà cung cấp tắt: khung báo trùng ghi "Không đăng nhập được? Liên hệ hỗ trợ" (trang Liên hệ); chủ dùng "Đặt mật khẩu tạm" ở trang Học viên (`adminResetPassword`, gắn được số mới cho tài khoản chưa có mật khẩu), khách quay lại trang mua, nhập số + mật khẩu tạm → nhánh `set_password` ngay trên trang mua → mua tiếp. E2e Task 3 kiểm trọn đường cứu này (đặt mật khẩu tạm cho tài khoản không có mật khẩu → mua tiếp tới trang thanh toán).

## Review Focus

1. Mất kết nối ngay sau khi máy chủ đã tạo tài khoản (khách chưa thấy mật khẩu) → lần bấm lại nhận `phone_taken`; trang phải nói rõ "số này vừa được đăng ký" và chỉ cách lấy lại (liên hệ hỗ trợ / chủ đặt mật khẩu tạm), không im lặng.
2. Bấm "Tiếp tục" hai lần → chỉ một tài khoản, một đơn (nút khóa khi đang gửi; máy chủ đã khóa theo số).
3. Khách rời trang trước khi chép mật khẩu → vẫn đăng nhập trên máy đó nhưng không còn cách xem lại mật khẩu; bản này chặn bằng ô bắt buộc "Tôi đã lưu mật khẩu" trước khi sang thanh toán. Mất mật khẩu sau đó: chủ đặt mật khẩu tạm (đã có ở trang Học viên).
4. Người đã đăng nhập mở `/mua/<slug>` → giữ nguyên luồng cũ (không thấy form khách).
5. `/mua/<slug>` công khai không được làm lộ API `me`: các API `/api/me/*` vẫn đòi phiên.

---

### Task 1: API đăng ký nhanh với mật khẩu tự cấp

**Files:**
- Modify: `src/modules/auth-learner/password.ts` (xuất `generatedPassword()`)
- Create: `src/app/api/auth/learner/password/quick-register/route.ts`
- Test: `tests/integration/quick-register.test.ts`

**Interfaces:**
- Produces: `POST /api/auth/learner/password/quick-register` body `{ displayName: string(1..100), phone: string, email?: string, deviceKey: string, deviceLabel: string(1..100) }` → `200 { next: "done", password: string }` + cookie phiên học viên; `409 { error: "phone_taken" }`; `409 { error: "email_taken" }` (email trùng định danh email đã xác minh; kiểm sau số; email sai dạng → 400 `invalid_email`); `400 { error: "invalid_phone" }`; `429 { error: "throttled" }`. `export function generatedPassword(): string` trong `password.ts`.

- [ ] **Step 1: Viết test hỏng** `tests/integration/quick-register.test.ts`:
  - `"số mới → tạo tài khoản, có phiên, trả mật khẩu 10 ký tự đăng nhập lại được; DB chỉ có bản băm"`: gọi route với `{ displayName: "Khách mua nhanh", phone: "0912 000 111", deviceKey, deviceLabel: "Máy" }` → 200, `next === "done"`, `password` khớp `/^[A-Za-z0-9]{10}$/` theo `TEMP_ALPHABET`, có `set-cookie` `__Host-me_learn`; `loginWithPassword({ phone: "0912000111", password })` → `ok`; `password_logins.password_hash` không chứa `password`; `must_change = false`.
  - `"số đã có tài khoản → 409 phone_taken, không trả mật khẩu, không tạo tài khoản thứ hai"`.
  - `"email trùng email đã xác minh của tài khoản khác → 409 email_taken, không tạo tài khoản"`; `"email mới → tạo tài khoản, email không được lưu vào user_identities"`; `"email sai dạng → 400 invalid_email"`.
  - `"mọi phản hồi (200, 409, 400) có Cache-Control chứa no-store"`.
  - `"số sai → 400 invalid_phone"`; `"tên trống → 400"`.
  - `"dùng chung hạn mức đăng ký theo IP với /register → 429 throttled"` (đăng ký `REGISTRATIONS_PER_IP_HOUR` lần rồi thêm một lần).
  - `"thiếu Origin cùng site → 403"` (`requireSameOrigin`).
- [ ] **Step 2: Chạy** `pnpm vitest run --project integration tests/integration/quick-register.test.ts` → FAIL (route chưa có).
- [ ] **Step 3: Cài**: `generatedPassword()` = `temporaryPassword` hiện có (đổi tên/xuất); route giống `register/route.ts` nhưng không nhận `password`/`rank`, gọi `registerWithPassword({ phone, password: generatedPassword(), displayName, rank: null, ip }, then)`, trả `{ next: "done", password }` khi phiên tạo xong; `choose_device` không thể xảy ra với tài khoản mới (vẫn xử lý như `register`).
- [ ] **Step 4: Chạy lại** → PASS; chạy `tests/integration/password-login.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(auth): quick registration with a system-generated password for guest checkout`.

### Task 2: Trang mua công khai cho khách

**Files:**
- Modify: `src/modules/sessions/routes.ts` (`/mua` → `public`)
- Modify: `src/app/(site)/mua/[slug]/buy-form.tsx` (bỏ chuyển sang đăng nhập khi 401; hiện `GuestForm`)
- Create: `src/app/(site)/mua/[slug]/guest-form.tsx`
- Test: `tests/unit/` không có — kiểm bằng `tests/integration/routes.test.ts` (phân loại đường dẫn) và e2e Task 3.

**Interfaces:**
- Consumes: Task 1 route; `POST /api/auth/learner/password/login` (`{ phone, password, deviceKey, deviceLabel }` → `next: "done" | "choose_device" | "set_password"`); `POST /api/me/orders`; `getDeviceKey`, `deviceLabel`, `NEXT_KEY`, `DEVICES_KEY` từ `src/app/(site)/dang-nhap/`.
- Produces: `GuestForm({ slug, onSignedIn: () => void })`.

- [ ] **Step 1: Test hỏng** trong `tests/integration/routes.test.ts`: `expect(classifyPath("/mua/engine_cadet_tanker")).toBe("public")` và `/thanh-toan/X`, `/hoc`, `/api/me/orders` vẫn `learner`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Cài**:
  - `routes.ts`: bỏ `/mua` khỏi danh sách học viên.
  - `buy-form.tsx`: `/api/me/session` trả 401 → trạng thái `guest` (không `router.replace`); `guest` thì hiện `GuestForm` trong cột trái thay cho khung "Tài khoản mua"; tạo đơn trả 401 → về `guest`.
  - `GuestForm` các bước: `form` (Họ và tên *, Số điện thoại *, Email (không bắt buộc, ghi chú "Để nhận ra tài khoản bạn đã có"), ghi chú "Dùng số này để đăng nhập lần sau", link "Đã có tài khoản? Đăng nhập" → `/dang-nhap?next=/mua/<slug>`) → gọi quick-register →
    - 200: bước `saved` hiện "Tài khoản của bạn" — số điện thoại, **mật khẩu** chữ to, nút "Sao chép", nhắc "Chụp màn hình hoặc ghi lại. Mật khẩu chỉ hiện một lần."; ô "Tôi đã lưu mật khẩu" bắt buộc trước khi gọi `onSignedIn()`.
    - 409 `email_taken`: "Email này đã có tài khoản" + nút "Đăng nhập bằng email" (`/dang-nhap?next=/mua/<slug>`).
    - 409 `phone_taken`: bước `login` "Số này đã có tài khoản. Nhập mật khẩu để mua tiếp." + ô mật khẩu + nút "Đăng nhập cách khác" (`/dang-nhap?next=/mua/<slug>`) → API đăng nhập: `done` → `onSignedIn()`; `choose_device` → lưu `NEXT_KEY=/mua/<slug>`, `DEVICES_KEY`, `router.push("/dang-nhap/chon-thiet-bi")`; `set_password` → hiện ô "Mật khẩu mới" (cùng quy tắc `WEAK` của `phone-form.tsx`) và gửi lại với `newPassword`, `done` → `onSignedIn()`; `invalid`/`locked` → thông báo như `phone-form.tsx` (dùng lại `MESSAGE`), kèm "Quên mật khẩu?" và dòng "Vừa đăng ký mà chưa thấy mật khẩu? Liên hệ hỗ trợ ở trang Liên hệ." (Review Focus 1).
    - 400/429: thông báo như `phone-form.tsx`.
  - `onSignedIn()` trong `buy-form.tsx`: đặt tên tài khoản, rồi tạo đơn như nút "Tiếp tục thanh toán" hiện có (ô điều khoản vẫn bắt buộc, ở cuối form khách).
- [ ] **Step 4: Chạy** test routes → PASS; `pnpm typecheck`, `pnpm lint` sạch.
- [ ] **Step 5: Commit** `feat(checkout): guests buy without signing in first`.

### Task 3: Kiểm trên trình duyệt và tài liệu

**Files:**
- Create: `tests/e2e-ui/guest-checkout.mjs`
- Modify: `tests/e2e-ui/purchase.mjs`: bước 1 cũ ("chưa đăng nhập vào trang mua → trang đăng nhập có next") đổi thành: mở `/mua/<slug>` thấy form khách → bấm "Đã có tài khoản? Đăng nhập" → kiểm URL `/dang-nhap?next=%2Fmua%2F<slug>`; từ đó giữ nguyên toàn bộ các bước sau (đăng nhập email bằng mã, quay lại trang mua, điều khoản, đơn, webhook, hoàn tiền, vào học).
- Modify: `src/app/(site)/page.tsx` (bước 1 "Chọn khóa, bấm Mua" → "điền tên và số điện thoại, tài khoản tự tạo")
- Modify: `CLAUDE.md` (mục D2/thanh toán: đăng ký nhanh ở trang mua), danh sách e2e

- [ ] **Step 1: Viết** `guest-checkout.mjs <base> <slug> <outdir>` kiểm: khách mở `/mua/<slug>` thấy form (không bị đưa sang đăng nhập); điền tên + số mới + tích điều khoản → thấy mật khẩu 10 ký tự và nút Sao chép; chưa tích "Tôi đã lưu" thì không sang được; tích → sang `/thanh-toan/ME…`; đăng xuất, mở lại `/mua/<slug>` bằng cùng số → "Số này đã có tài khoản" → nhập sai mật khẩu → báo sai; nhập mật khẩu vừa nhận → sang trang thanh toán của **đơn cũ** (không tạo đơn thứ hai); tài khoản có mật khẩu tạm của chủ (đặt bằng `admin:set-password`-tương đương cho học viên: `adminResetPassword`) → trang mua hỏi mật khẩu mới rồi mua tiếp; số đã xác minh nhưng không có mật khẩu → có nút "Đăng nhập cách khác" trỏ đúng `next`, rồi chủ đặt mật khẩu tạm (kèm số) cho tài khoản đó qua `adminResetPassword` → khách nhập số + mật khẩu tạm trên trang mua → đặt mật khẩu mới → tới trang thanh toán; email trùng tài khoản đã có → báo "Email này đã có tài khoản", nút trỏ đúng `next`, có dòng "Liên hệ hỗ trợ"; không lỗi giao diện ở 390 và 1280; không lỗi console.
- [ ] **Step 2: Chạy** trên bản build cục bộ → ĐẠT; chạy lại `purchase.mjs`, `transfer-claim.mjs` → ĐẠT.
- [ ] **Step 3: Sửa chữ trang chủ, CLAUDE.md.**
- [ ] **Step 4: Chạy** `pnpm test` (toàn bộ) → xanh.
- [ ] **Step 5: Commit** `test(e2e): guest checkout; docs`.
