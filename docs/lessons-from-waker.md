# Bài học từ dự án Waker

Ghi ngày 29/10/2026 sau khi đọc `/home/bilyz/project/waker` (chỉ đọc, không sửa). Waker là nền tảng bán hàng kèm CMS,
Rails 7 + PostgreSQL, một mã nguồn cho nhiều khách hàng (mỗi khách một database, theme, `.env.<khách>.local`).
Trang công khai đọc dữ liệu qua `app/operations/`, trang quản trị ghi qua `admin/app/cmds/`.

Marine English **vẫn giữ** Next.js + PostgreSQL + Auth.js trên một VPS (CLAUDE.md, chốt 30/10/2026). Tệp này chỉ lấy cách làm, không đề xuất đổi sang Rails.

## Nên áp dụng

| Điểm | Ở Waker | Áp dụng cho Marine English |
| --- | --- | --- |
| Mã đơn ngẫu nhiên không trùng | `app/models/concerns/has_code.rb` + `app/models/sku.rb`: tiền tố + `SecureRandom.hex(6)`, kiểm tra trùng thì sinh lại (tối đa 5 lần); index duy nhất `orders.code` trong `db/schema.rb` | Khớp quyết định mã đơn ngày 29/10. Dùng bảng ký tự không có ký tự dễ nhầm; nếu 5 lần vẫn trùng thì báo lỗi rõ thay vì để lỗi DB nổ ra |
| Tách đọc và ghi | Operations cho trang công khai; Commands (`SimpleCommand`) cho quản trị, trả `success?/errors/result` | Mọi thao tác ghi của quản trị (cấp quyền tay, hoàn tiền, đổi giá) đi qua một lớp command, ghi `admin_audit_log` tại một chỗ |
| Phân quyền tới từng dòng | `app/models/auth_policy.rb`: `build_scope` biến quyền thành điều kiện lọc; quyền `*` cho toàn quyền | Hợp với yêu cầu “người hỗ trợ chỉ truy cập phần việc được giao” (mục 5A) |
| Lịch chạy quản lý được | `app/models/schedule.rb`: cron, trạng thái lần chạy cuối, `execute_now!` | Bốn job (hết hạn đơn, gửi lại thông báo, đối soát SePay, xóa ghi âm) hiển thị trạng thái và lỗi trên trang quản trị |
| Thông báo theo kênh | Slack tách kênh đơn hàng và kênh lỗi; gửi lỗi không làm hỏng luồng chính | Giống kế hoạch Telegram: nhóm đơn hàng tách nhóm lỗi; thông báo lỗi không hủy việc mở khóa |
| Chống spam | `IpLog` + chặn IP theo số giờ cấu hình (`application_controller.rb`), reCAPTCHA trên form | Dùng cho form đăng ký và form tạo đơn |
| Nhật ký thao tác quản trị | `app/models/action_log.rb` + `admin/app/controllers/concerns/loggable.rb`: ghi người làm, dữ liệu trước khi sửa (`object_before`), trường đã đổi (`changed_data`), trạng thái `created/finished/failed`, tại một chỗ cho mọi thao tác | Mẫu cho `admin_audit_log`: cấp quyền tay, hoàn tiền, đổi giá lưu cả giá trị trước và sau, kể cả khi thao tác lỗi |
| Theo dõi job lỗi | Kiểm tra `delayed_jobs` lỗi định kỳ, task `delayed_job:check_pending_job` báo Slack (`docs/12-jobs-scheduling.md`, mục Operational checklist) | Job lỗi hoặc treo báo về nhóm Telegram lỗi |
| Quy tắc phân quyền | `docs/11-auth.md` mục Quy tắc: kiểm quyền ở controller, không chỉ ẩn nút trên giao diện; đổi vai trò/quyền phải ghi `ActionLog`; vai trò `admin` gốc có cột `protected` để không xóa được qua giao diện | Kiểm quyền ở API route, không dựa vào việc ẩn nút; đổi vai trò ghi `admin_audit_log`; tài khoản chủ dự án không thể bị xóa hay hạ quyền qua giao diện |
| Bộ tài liệu đánh số | `docs/01-overview.md` … `docs/15-setup.md`, tiếng Việt, mỗi tệp một chủ đề | Khung cho `docs/` khi bắt đầu viết code |
| Quy trình git và review | Nhánh theo việc, merge request vào `dev`, commit bắt đầu bằng động từ kèm mã ticket; mỗi thay đổi qua codex-review (`.codex-review/sessions/`) | Áp dụng khi dự án có code và có git |

## Không làm theo

1. **Tin giá từ trình duyệt.** `OrdersController#create_direct_buy_order` lấy `params[:price]`, kèm `TODO: get price by variant from server`.
   Marine English: giá luôn lấy từ `courses` trên máy chủ.
2. **Tài liệu lệch với code.** `docs/14-integrations.md` mô tả luồng OnePay có kiểm chữ ký, nhưng không tìm thấy OnePay trong
   các tệp `.rb/.haml/.erb/.liquid`; `PaymentController` chỉ hiển thị giao diện. Tài liệu của mình phải ghi rõ phần đã chạy thật
   và phần dự kiến.
3. **Đơn chỉ có 2 trạng thái** (`draft`, `created`), không có bảng `payments`. Không đối soát được, không chống xử lý trùng giao dịch.
   Marine English giữ 5 trạng thái và `payments.transaction_id` duy nhất.
4. **Không có test.** README ghi rspec nhưng repo không có `spec/` hay `test/`.
5. **Quyền cache 6 giờ** (`permissions_of_<user>`), chỉ đúng nếu mọi chỗ đổi quyền đều xóa cache. Quyền học trong `enrollments`
   nên đọc trực tiếp, không cache lâu, để hoàn tiền thu hồi quyền ngay.
6. **Tắt CSRF** ở `OrdersController` (`skip_before_action :verify_authenticity_token`). Form tạo đơn của mình phải giữ chống CSRF.
7. **Mã đơn chỉ duy nhất trong các đơn chưa xóa.** Index `index_orders_on_code` có `where: "(discarded_at IS NULL)"`, và
   `HasCode` cũng chỉ kiểm tra trùng trong phạm vi mặc định. Đơn đã xóa mềm có thể bị trùng mã với đơn mới.
   Marine English: mã đơn nằm trong nội dung chuyển khoản, nên phải duy nhất trên **mọi** đơn kể cả đã xóa,
   nếu không giao dịch cũ có thể bị ghép nhầm sang đơn mới.
8. **Khóa job không nguyên tử, không hết hạn.** `ScheduleDispatcher#run` kiểm tra `running?` rồi mới `update!` sang `running`:
   hai lần gọi cùng lúc vẫn lọt qua; tiến trình chết giữa chừng thì kẹt ở `running` mãi. Marine English: khóa job
   (đối soát SePay, hết hạn đơn) phải nguyên tử (ví dụ `UPDATE … WHERE status <> 'running'` hoặc advisory lock của Postgres)
   và có thời hạn khóa.
9. **Múi giờ cron không rõ.** Chính tài liệu Waker ghi chưa chắc cron chạy theo UTC hay giờ máy chủ.
   Marine English (cron trên VPS): đặt múi giờ rõ ràng. Theo `Asia/Ho_Chi_Minh` thì tổng kết Telegram 21:00 là `0 21 * * *`,
   theo UTC thì `0 14 * * *`. Ghi rõ múi giờ cạnh mỗi lịch.
10. **Không khóa đăng nhập khi nhập sai nhiều lần.** `User` không bật `:lockable` (cấu hình `maximum_attempts` đang bị comment
    trong `config/initializers/devise.rb`) dù có `Admin::UnlocksController`. Marine English đăng nhập bằng email, Google hoặc mã qua Zalo
    (Auth.js), không có mật khẩu nhưng vẫn cần giới hạn số lần gửi mã/đăng nhập theo tài khoản, số điện thoại và IP, nhất là với
    trang quản trị. Mã qua Zalo còn tính phí mỗi tin, nên gửi mã tràn lan cũng là thiệt hại tiền.

## Đã xem nhưng không áp dụng

Nhiều khách hàng một mã nguồn, theme động, page/action caching, tìm kiếm `pg_search`, giỏ hàng ẩn danh theo cookie
`customer_uuid` (khóa học của mình bắt buộc đăng nhập).

## Giới hạn

Đây là ghi chép từ việc đọc mã và tài liệu, chưa chạy Waker. Kết luận “không có OnePay” dựa trên tìm kiếm trong các tệp
`.rb/.haml/.erb/.liquid`; theme có thể nằm trong database nên chưa loại trừ hẳn.
