# Bài học từ cfaonline: thanh toán và mua khóa học (16/11/2026)

Đọc mã `/home/bilyz/project/cfaonline` (Rails 5.2 + MongoDB, chỉ đọc) theo yêu cầu của anh. Model đơn hàng, coupon và nhật ký nằm trong gem riêng `fagogroups/*`, không có trong repo.

## Luồng mua ở cfaonline

1. Trang khóa học có nút "THANH TOÁN". Bấm vào thì khóa được thêm vào đơn của khách (lưu theo session) và mở trang `/payment`.
2. Trang `/payment` gom mọi thứ vào một trang: giỏ hàng, tổng tiền, thông tin người mua, ô mã giảm giá và chọn cách trả. Có 4 cách: thẻ quốc tế, ATM, VNPay QR và trả góp 0% qua VNPay. Không cần đăng nhập.
3. Người mua được chuyển sang VNPay. VNPay gọi lại máy chủ qua IPN (tin báo kết quả thanh toán):
   - kiểm IP gửi đến và chữ ký HMAC-SHA512;
   - so số tiền và mã đơn;
   - nhận cùng một tin báo hai lần chỉ xử lý một lần;
   - ghi mọi lần gọi vào `OrderLog`.
4. Trang "thanh toán thành công" trình bày như biên lai. Không có bước tự mở khóa học: nhân viên đọc email báo rồi cấp khóa bằng tay.

## Nên học

| Điểm | Marine English hiện tại |
|---|---|
| Mã giảm giá: báo ngay "Đã áp dụng mã X", hiện giá mới cạnh giá cũ, mã sai báo đỏ | Chưa có mã giảm giá (CLAUDE.md có dự kiến "tối đa một coupon"). **Chờ anh quyết.** |
| Gói combo nhiều khóa (BASIC/STANDARD/ELITE) có bảng so sánh | Chưa có gói combo. Có thể làm gói "trọn chức danh" theo danh mục. **Chờ anh quyết.** |
| Ô xuất hóa đơn VAT (tên công ty, mã số thuế, địa chỉ) | Chưa có. Cần nếu công ty tàu trả tiền thay thuyền viên. **Chờ anh quyết.** |
| Trang thành công kiểu biên lai, có số hotline hỗ trợ | Đã có trang kết quả thanh toán; có thể bổ sung dòng hotline khi anh đưa số. |
| Giải thích lỗi thanh toán bằng tiếng Việt dễ hiểu | Đã có hàng chờ "cần xử lý tay"; có thể thêm câu giải thích cho người mua cho từng trường hợp: sai số tiền, sai nội dung, chuyển trễ. |
| Ghi mọi lần cổng thanh toán gọi về, kể cả lần bị từ chối | Webhook SePay bị từ chối chỉ ghi vào log máy chủ, không lưu vào cơ sở dữ liệu. Ghi vào cơ sở dữ liệu thì dễ tra lại hơn. |
| Khóa nút trả tiền khi đang xử lý (tránh bấm hai lần) | Đã có. |

## Không được học (lỗi ở cfaonline)

- **Giá do trình duyệt gửi lên** (`price_total`), giảm giá chỉ tính bằng JavaScript: người mua có thể sửa thành 1.000đ rồi trả 1.000đ. Ở mình, giá luôn lấy từ bảng `courses` trên máy chủ.
- **Đơn chuyển "success" ngay khi bấm nút,** trước khi có tiền. Tin báo từ VNPay cũng không kiểm mã kết quả `00`, nên thanh toán thất bại vẫn có thể bị ghi là thành công. Ở mình, đơn chỉ được tính đã thanh toán khi có giao dịch ngân hàng đã xác minh.
- **Mã đơn tăng dần** (`a1001…`), và ai biết mã đơn là xem được thông tin người mua. Ở mình, mã đơn ngẫu nhiên và trang đơn có kiểm quyền.
- **Một số API trong khu quản trị chọn bảng dữ liệu và hàm theo tham số người gửi lên,** lại bỏ qua kiểm CSRF (chống giả mạo yêu cầu): ai gọi được API là sửa được bất kỳ dữ liệu nào.
- **So chữ ký bằng `==`** thay vì cách so thời gian cố định (an toàn hơn trước kiểu tấn công đo thời gian).
- **Gửi email ngay trong lúc xử lý yêu cầu,** nên máy chủ email chậm thì bước mua cũng chậm theo.
- **Không có hạn đơn,** không gửi gì cho người mua, và không có trang để người mua xem trạng thái đơn.
