# Bài học từ dự án LMS Cole

Ghi ngày 30/10/2026 sau khi đọc `/home/bilyz/project/lms_cole` (chỉ đọc, không sửa, không chạy). LMS Cole là hệ thống quản lý học tập:
`lms_be/` Spring Boot 4 + Java 21 + PostgreSQL + Redis + RabbitMQ, JWT + Google OAuth2; `lms_admin_fe/` React + Vite (antd, MUI,
Tailwind, Redux). Có khóa học, lớp, bài thi, lộ trình học, thanh toán OnePay, OTP qua Zalo OA (ZNS) / email, đồng bộ nền tảng Me và MISA.

Marine English vẫn giữ Next.js + PostgreSQL + Auth.js trên một VPS (CLAUDE.md, chốt 30/10/2026). Tệp này lấy cách làm, nhất là phần **OTP qua Zalo**, vì Marine English đã chọn
gửi mã đăng nhập qua Zalo ZNS (30/10/2026) và LMS Cole đã có bản chạy thật.

## Nên áp dụng

| Điểm | Ở LMS Cole | Áp dụng cho Marine English |
| --- | --- | --- |
| Gửi mã qua Zalo ZNS | `service/otp/ZaloOaProvider.java`: gọi API ZNS theo mẫu (`templateId`, `templateData.otp`), `trackingId` ngẫu nhiên, chuẩn hóa số điện thoại (`PhoneUtils.normalizeToZero`), kiểm tra cấu hình trước khi gửi | Mẫu cho provider Zalo của Auth.js: cấu hình OA, mẫu tin chỉ chứa mã, log yêu cầu/phản hồi. Hỏi xem có dùng chung Zalo OA / đối tác ZNS của Cole được không |
| Vòng đời mã OTP | `service/OtpService.java`: mã sống 5 phút, lưu ở cache; sau khi xác minh giữ trạng thái “đã xác minh” 2 phút; tối đa 10 lần gửi / 24 giờ cho mỗi số | Giữ hạn 5 phút và giới hạn số lần gửi; thêm giới hạn theo IP và khoảng chờ giữa hai lần gửi (xem mục dưới) |
| Nhật ký gửi mã | Bảng `otp_logs`: kênh, nhà cung cấp, người nhận, hạn, số lần, thời điểm xác minh, payload và phản hồi | Lưu nhật ký để đối soát chi phí ZNS và điều tra khiếu nại “không nhận được mã” (không lưu mã dạng rõ, xem dưới) |
| Chọn kênh theo liên hệ | `resolveChannelType`: có `@` → email, 10–12 chữ số → điện thoại | Khớp màn `Login` (một liên hệ: điện thoại hoặc email) |
| Nhà cung cấp hoán đổi được | `PaymentServiceFactory`, `SmsGatewayFactory`, `StorageProviderFactory` (ổ đĩa / AWS), `AuthStrategyFactory` | Giống NFR-18: gói SePay sau một module, Zalo sau một provider; lưu tệp qua một module (hôm nay ổ đĩa VPS, sau có thể R2/S3) |
| Khóa dòng khi xử lý thanh toán | `PaymentTransactionRepository.findForUpdateByTransactionRef` (khóa dòng), giao dịch đã `SUCCESS` thì trả về ngay, kiểm tra merchant, chữ ký, số tiền | Webhook SePay: khóa dòng đơn/giao dịch trong cùng transaction, gặp lại mã giao dịch đã xử lý thì trả thành công, không làm lại |
| Chữ ký đúng mà mã lệch thì không kết luận | Mã thành công nhưng sai chữ ký → giữ `PENDING`, ghi “cần QueryDR” | Không chắc thì đưa đơn vào “cần xử lý tay”, không tự mở khóa |
| Mã giao dịch không đoán được | `"COLE_" + UUID` | Cùng ý với mã đơn ngẫu nhiên `ME…` |
| Gửi thông báo không giữ kết nối DB | Commit `4609cea` (05/10/2026): nhắc lịch học từng giữ kết nối DB trong lúc gửi email qua RabbitMQ (chờ xác nhận tới 10 giây/email) trên pool 10 kết nối, làm 11 lớp không nhận được nhắc; sửa bằng cách tải đủ dữ liệu trước rồi gửi ngoài transaction. Cũng trong commit đó: `Map.of` lỗi khi giá trị null (26/49 lớp thiếu link phòng học) | Mở khóa trong transaction ngắn, commit xong mới gửi email/Zalo/Telegram, đúng quy tắc “thông báo lỗi không hủy mở khóa”. PostgreSQL trên VPS cũng có giới hạn kết nối (`max_connections`, pool của app). Mẫu tin phải chịu được trường trống (học viên không có email, thiếu tên) |
| Xóa mềm, DTO, bọc phản hồi | Cột `deletedAt`; controller không trả entity; mọi phản hồi qua `ApiResponse<T>` | Quy ước tốt khi dựng API |

## Không làm theo

1. **Không giới hạn số lần nhập sai mã.** `verifyOtp` chỉ so mã, không đếm lần sai: mã 6 số có thể dò trong 5 phút.
   Marine English: khóa mã sau khoảng 5 lần sai, buộc gửi mã mới.
2. **Sinh mã bằng `java.util.Random`** (`generateOtp`), không phải nguồn ngẫu nhiên an toàn. Dùng `crypto.randomInt`.
3. **Trạng thái “đã xác minh” không gắn mục đích và không bị tiêu thụ.** `isIdentifierVerified` dùng chung cho `register` và
   `resetPassword`, gọi nhiều lần trong 2 phút vẫn đúng. Marine English: mã gắn với một mục đích, dùng một lần.
4. **Lưu mã OTP dạng rõ trong `otp_logs`** và đẩy phản hồi ZNS vào `Debug.pushNotification`. Chỉ lưu bản băm hoặc không lưu mã.
5. **Giới hạn gửi chỉ theo số điện thoại, không theo IP, không có khoảng chờ.** Kẻ xấu đổi số liên tục vẫn gửi được, mỗi tin ZNS tốn tiền.
6. **Hai nơi ghi nhận tiền, không gắn với nhau.** Thanh toán OnePay trong LMS chỉ cập nhật `PaymentTransaction`, bảng này không có
   cột liên kết `Order`, và không chỗ nào đặt `OrderStatus.PAID`. Việc ghi nhận đã trả tiền đi qua nền tảng Me: `MeSyncService` đặt
   `PaymentScheduleStatus.PAID` cho từng đợt thanh toán khi Me gọi sang. Trang quay về sau thanh toán (`handlePaymentResponse`) cũng
   tự đổi giao dịch sang `SUCCESS`. Marine English: một nguồn sự thật duy nhất; giao dịch luôn gắn mã đơn; chỉ webhook có chữ ký hoặc
   cấp tay mới đổi đơn và tạo `enrollments`, trong cùng transaction.
7. **Chống trùng kiểu “đọc rồi ghi” không khóa.** `MeSyncService` kiểm tra `alreadyPaid` để tránh cộng dồn khi Me gọi trùng
   (comment ghi rõ “gọi 2 lần cùng lúc”), nhưng câu đọc `findByOrderAndInstallmentNo` không khóa dòng, nên hai lời gọi đồng thời vẫn có
   thể cùng thấy “chưa trả” (chưa thử, suy từ mã). Marine English: dựa vào ràng buộc duy nhất `payments.transaction_id` hoặc khóa dòng.
8. **Không có giới hạn thiết bị.** Không thấy refresh token hay bảng thiết bị/phiên; JWT không bị thu hồi theo thiết bị.
   Quy tắc “tối đa 2 thiết bị” của Marine English phải tự thiết kế, không có mẫu để chép.
9. **Tài liệu lệch thực tế.** `lms_cole/CLAUDE.md` ghi `lms_admin_fe` trống và có thư mục `docs/` ở backend; thực tế frontend đã có mã,
   `lms_be/docs/` không tồn tại. Gần như không có test (1 tệp kiểm tra khởi động).
10. **Frontend dùng cùng lúc antd, MUI và Tailwind.** Marine English giữ một hệ giao diện.

## Giới hạn

Chỉ đọc mã, chưa chạy. Mục 6 và 7 dựa trên đọc mã (`OrderStatus.`, `MeSyncService`), chưa thử gọi đồng thời; luồng Me
(`MeCreatePaymentService`, phần còn lại của `MeSyncService`) chưa đọc hết. Chưa đọc: bài thi, lộ trình học, MISA, lưu trữ tệp,
trang quản trị React — không liên quan trực tiếp tới các quyết định hiện tại của Marine English.
