# Quản trị đăng nhập bằng email + mật khẩu (D3, 02/11/2026)

**Yêu cầu của anh:** màn `/admin/dang-nhap` giống màn đăng nhập học viên (ảnh), không cần tạo tài khoản; chọn "Email + mật khẩu".

## Thiết kế

- **Bảng mới** (migration `admin_passwords`):
  - `admin_passwords` (`admin_user_id` khóa chính, `password_hash`, `updated_at`). Ràng buộc: xóa admin thì xóa luôn mật khẩu.
  - `admin_login_attempts` (`email_lower`, `ip`, `ok`, `at`), có chỉ mục theo email và IP.
  - Quyền của `me_app`: đọc, thêm, sửa `admin_passwords`; đọc, thêm và chỉ sửa cột `ok` của `admin_login_attempts`.
  - Hàm dọn chạy bằng quyền chủ bảng (SECURITY DEFINER) cùng job dọn lượt thử 30 ngày: thêm vào job `me.auth.prune-password-attempts`.
- **Đăng nhập** `POST /api/auth/admin/password/login {email, password}`, chỉ nhận yêu cầu cùng nguồn. Làm theo ba bước như D2:
  1. Giao dịch ngắn: khóa theo IP rồi theo email; nếu đang bị khóa thì trả `locked`. Nếu không, ghi trước một lượt thử là sai.
  2. Kiểm mật khẩu (băm) ngoài giao dịch. Email không có trong danh sách, chưa đặt mật khẩu hoặc tài khoản không ở trạng thái đang hoạt động: vẫn băm giả cho mất cùng thời gian, rồi trả `invalid`.
  3. Mật khẩu đúng: kiểm lại tài khoản vẫn đang hoạt động và mã băm chưa đổi, đánh dấu lượt thử là đúng, tạo phiên quản trị (`authAt = now`), ghi nhật ký `admin_login` với lý do `password`.
  - Mật khẩu sai mà email có thật thì ghi nhật ký từ chối.
- **Đặt/đổi mật khẩu** `POST /api/quan-tri/me/password {password}`:
  - Chỉ khi đăng nhập trong 10 phút gần đây; nếu không thì trả 403 `reauth_required`.
  - Chính sách mật khẩu: 8–128 ký tự, không là mật khẩu phổ biến, không trùng email hay phần trước @.
  - Băm ngoài giao dịch. Ghi đè mật khẩu cũ, hủy các phiên quản trị khác của người đó, ghi nhật ký `admin_password_set`.
- **`GET /api/quan-tri/me`** trả thêm `hasPassword`.
- **Giao diện:**
  - `/admin/dang-nhap`: thanh menu và chân trang giống trang khách, khung giống màn đăng nhập học viên. Có ô Email, ô Mật khẩu, nút Đăng nhập và "Quên mật khẩu?" (hướng dẫn xin link). Google và link email chỉ hiện khi bật. Link `#link=` giữ nguyên.
  - Khu quản trị: chưa có mật khẩu thì hiện dải nhắc. Trang `/admin/mat-khau` để đặt hoặc đổi mật khẩu; thanh bên có mục "Mật khẩu".

## Test

- **Tích hợp:** đăng nhập đúng tạo phiên quản trị kèm nhật ký. Các trường hợp sau đều trả `invalid` giống hệt nhau:
  - sai mật khẩu;
  - email không có;
  - chưa đặt mật khẩu;
  - tài khoản đã thu hồi.
- Khóa sau 5 lần sai theo email và 20 lần theo IP.
- Đặt mật khẩu cần đăng nhập gần đây, hủy phiên khác, từ chối mật khẩu yếu.
- Hỗ trợ cũng đặt được mật khẩu của chính mình.
- Phiên học viên không gọi được API quản trị.
- Job dọn xóa lượt thử của quản trị quá 30 ngày.
- **Trình duyệt:** chủ vào bằng link, đặt mật khẩu, đăng xuất, đăng nhập bằng email + mật khẩu. Sai mật khẩu thì báo lỗi. Màn hình điện thoại không tràn.
