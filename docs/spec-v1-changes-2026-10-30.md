# Thay đổi cần ghi vào tab “Spec giao diện v1 (chốt 29/10)” — soạn 30/10/2026

**Đã ghi vào tab Spec (mục 10 “Thay đổi sau ngày chốt”, bản rev 15, 30/10/2026)** khi tài khoản mới mở được tài liệu; tên tệp đã đổi sang mã màn WEB/APP/ADM.
Tệp này giữ làm bản nháp gốc; nguồn sự thật là tab Spec.

Tab Spec nằm trong https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD. Tài khoản đăng nhập ngày 30/10 không mở được tài liệu này,
nên nội dung dưới đây được soạn sẵn để dán vào tab Spec khi có quyền, **trước** khi sửa bảng thiết kế (theo quy ước).
Tên màn dùng tên tệp `.dc.html`; khi dán, đổi sang mã màn WEB/APP/ADM tương ứng trong tab Spec (chưa đối chiếu được).
Căn cứ: quyết định 29–30/10 trong CLAUDE.md và bản rà soát `docs/ui-review-2026-10-30.md` (có ảnh chứng minh).

## A. Quyết định mới ảnh hưởng giao diện

| Ngày | Quyết định | Màn bị ảnh hưởng |
| --- | --- | --- |
| 29/10 | Thanh toán bằng ảnh QR có sẵn của tài khoản ngân hàng; SePay theo dõi tài khoản, tự xác nhận theo mã đơn trong nội dung + số tiền; sai thì “cần xử lý tay”. Chưa dùng payOS | `Checkout`, `MobileCheckout`, `BuyerInfo`, `Home`, `Main`, `Mobile` |
| 29/10 | Giữ hạn đơn 15 phút, tính theo thời điểm giao dịch ngân hàng | `Checkout` (đồng hồ, trạng thái hết hạn) |
| 29/10 | Cấp khóa tay bắt buộc nhập mã giao dịch ngân hàng, từ chối mã đã dùng | `Main`, `Mobile` |
| 29/10 | Mã đơn ngẫu nhiên không trùng (đề xuất `ME` + 8 ký tự, ví dụ `ME7K3QX9`, chờ xác nhận) | Mọi màn có mã đơn mẫu |
| 30/10 | Đăng nhập học viên: email, Google, hoặc số điện thoại nhận mã qua Zalo (ZNS); không SMS | `Login`, `Home`, `Checkout` (thành công) |
| 30/10 | Một tài khoản học viên gắn nhiều cách đăng nhập; tự liên kết trong “Tài khoản của tôi”; admin gộp tay | `Account`, màn mới gộp tài khoản |
| 30/10 | Tách tài khoản quản trị (`admin_users`) khỏi học viên; quản trị đăng nhập bằng Google hoặc link email trong danh sách cho phép, tại `/quan-tri` | `Main`, `Content`, màn mới đăng nhập quản trị, màn mới quản lý quản trị |

## B. Sửa màn hiện có

1. **`Checkout`**
   - Bỏ “Thanh toán an toàn qua payOS” và nhãn “[VietQR do payOS tạo]”; thay bằng ảnh QR có sẵn của tài khoản kinh doanh.
   - Bỏ “Số tiền và nội dung đã điền sẵn, không sửa nội dung”. Hướng dẫn: quét QR, **nhập đúng số tiền và nội dung `<mã đơn>`**.
   - Đưa khối số tài khoản / số tiền / nội dung có nút chép lên vị trí chính, nhấn mạnh nội dung bắt buộc đúng.
   - Trạng thái “Thành công”: báo theo kênh thật của học viên (email nếu có, Zalo nếu đăng ký bằng số điện thoại), không mặc định “đã gửi email”.
   - Nút “Áp dụng” mã giảm giá: đủ rộng để không xuống dòng.
   - Mã đơn mẫu `ME1055` đổi sang dạng ngẫu nhiên (ví dụ `ME7K3QX9`); cũng áp dụng cho `MobileCheckout`.
   - Trạng thái “Hết hạn”: “Bấm nút dưới để tạo mã mới” / nút “Tạo mã QR mới” đổi thành “Tạo đơn mới” (ảnh QR có sẵn không đổi;
     cái mới là mã đơn và hạn 15 phút). Giữ câu “Đã chuyển tiền rồi? Đừng chuyển lại… đối chiếu và mở khóa trong 24 giờ”.
2. **`MobileCheckout`**: bỏ hoặc đổi “Cách 1: Mở thẳng app ngân hàng — số tiền và nội dung tự điền sẵn” (ảnh QR có sẵn không làm được).
   Giữ cách lưu ảnh QR và khối “Chép”, câu “Ghi đúng nội dung … để khóa học tự mở”.
3. **`BuyerInfo`**: bước kiểm tra lại đổi “trước khi tạo mã QR” / nút “Tạo mã VietQR” thành “Sang thanh toán”.
4. **`Home`**
   - Bỏ “Số tiền và nội dung đã điền sẵn, không phải gõ”.
   - Bước 1 “Đăng nhập bằng email hoặc Google” thêm “hoặc số điện thoại (nhận mã qua Zalo)”.
   - **Sửa bố cục phần đầu trang:** `<section>` hero đang `width: 1428px; height: 549px; display: grid; grid-template-columns: repeat(2, …)`
     làm nội dung dồn trái và khung ảnh đè lên “Chọn khóa học”. Bỏ chiều rộng/cao cố định và lưới 2 cột ở thẻ ngoài (khối con đã tự chia 2 cột).
     Màn này chủ dự án sửa tay: hỏi trước khi sửa.
5. **`Main`, `Mobile`**
   - “Webhook payOS” → “Webhook SePay”.
   - Mã đơn mẫu đổi sang dạng ngẫu nhiên.
   - Nút “Cấp khóa” mở hộp thoại: ô **mã giao dịch ngân hàng (bắt buộc)**, số tiền nhận, ghi chú; báo lỗi nếu mã đã dùng; ghi nhật ký.
     Bỏ “Hoàn tác” ngay sau cấp; thu hồi là thao tác riêng có xác nhận và ghi nhật ký.
   - `Main` “Đơn gần đây”: cột mã đơn không xuống dòng (đủ rộng hoặc `white-space: nowrap`).
6. **`Main`, `Content`**: bỏ “· 2 thiết bị” ở dòng người đăng nhập quản trị. Thống nhất menu trái: `Content` thêm Cần xử lý tay,
   Hoàn tiền, Mã giảm giá, Nhật ký thao tác như `Main`.
7. **`Login`**: bước nhập mã ghi “Mã đã gửi qua Zalo tới …” khi liên hệ là số điện thoại, “qua email” khi là email; thêm dòng
   “Không dùng Zalo? Đăng nhập bằng email hoặc Google”. Thêm “Gửi lại mã” có đếm ngược và báo khi đã gửi quá số lần cho phép
   (mỗi tin Zalo tính phí; hiện màn chưa có nút gửi lại).
   - **`Policies`** (tab Bảo mật): thêm các bên xử lý dữ liệu theo quyết định mới — Zalo (nhận số điện thoại để gửi mã),
     SePay (đọc giao dịch của tài khoản nhận tiền), dịch vụ email; ghi mục đích từng bên. Mục 8A yêu cầu công bố bên xử lý trước khi thu thập.
8. **`Account`**: thêm nhóm “Cách đăng nhập”: số điện thoại (Zalo), email, Google; mỗi dòng trạng thái đã liên kết / liên kết thêm (cần xác minh).
9. **Khung trên bảng (`canvas.json`)**: tăng chiều cao `Home` (≥ 4245), `Main` (≥ 2118), `Mobile` (≥ 1870), `CadetCourse` (≥ 1961),
   `MobileCheckout` (≥ 1351).

10. **Theo `docs/design-gates-2026-10-30.md` (review 30/10):**
   - `Main`/`Mobile` “Đơn cần xử lý tay”: liệt kê **giao dịch ngân hàng** chưa phân bổ (kể cả giao dịch không có mã đơn), không chỉ đơn;
     thao tác “Ghép với đơn” (nhập/chọn mã giao dịch) tách khỏi “Cấp không thu tiền” (lý do bắt buộc, chỉ chủ).
   - `Account`: thêm “Thiết bị của tôi” (tối đa 2, gỡ thiết bị), và dòng thời hạn học offline còn lại.
   - `MyCourses`: báo dung lượng trước khi tải, trạng thái tải từng khóa, cảnh báo dữ liệu offline bị xóa / giấy phép offline sắp hết.
   - `Policies`: nêu rằng nội dung đã tải không bị thu hồi ngay khi máy chưa có mạng; thời hạn học offline.

## C. Màn mới

| Màn | Nội dung chính |
| --- | --- |
| Đăng nhập quản trị | “Tiếp tục với Google” và “Gửi link đăng nhập qua email”; báo rõ khi email không nằm trong danh sách cho phép; không có đăng ký |
| Quản lý quản trị | Danh sách email được phép, vai trò chủ / hỗ trợ, thêm / bỏ; tài khoản chủ không xóa hay hạ quyền được; mọi thay đổi ghi nhật ký |
| Gộp tài khoản học viên | Chọn hai tài khoản, xem trước khóa đã mua và tiến độ sẽ chuyển, xác nhận; ghi nhật ký |
| Sổ giao dịch ngân hàng | Danh sách mọi giao dịch SePay báo về, trạng thái phân bổ, lọc chưa phân bổ / trùng / đã hoàn |
| Trạng thái job và sao lưu | Lần chạy gần nhất, lỗi, nút chạy lại tay; sao lưu gần nhất và lần thử khôi phục gần nhất |

Chưa đưa vào Spec (đề xuất từ trước, chưa được yêu cầu): Hồ sơ nghề nghiệp, “Về tôi” bản điện thoại, lối vào Nội dung trên
Dashboard điện thoại.

## D. Cách kiểm tra sau khi sửa

Tải lại `docs/design/giao-dien-v1/` từ bảng, chụp lại theo `docs/design/tools/README.md`, đối chiếu từng dòng ở mục B với ảnh mới.
