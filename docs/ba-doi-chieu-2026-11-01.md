# Đối chiếu tab “Tài liệu BA” với mã nguồn (cổng G1) — 01/11/2026

Nguồn: tab “Tài liệu BA” trong https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD (mục 6–9), so với nhánh `phase1` sau P1–P5.
Tài liệu BA là nguồn yêu cầu chuẩn, nên **không sửa tài liệu BA ở đây**: báo cáo này chỉ liệt kê chỗ lệch để anh quyết sửa BA hay sửa mã.

Ký hiệu: **Có** = mã đã làm đúng · **Khác** = mã làm khác BA theo một quyết định đã ghi (BA nên cập nhật) · **Chờ** = chưa làm vì cổng hay nội dung của anh · **Chưa** = chưa làm, không có quyết định nào hoãn.

## Cần anh quyết (BA và mã đang nói khác nhau)

| Mục BA | BA ghi | Mã đang làm | Căn cứ | Đề xuất |
| --- | --- | --- | --- | --- |
| FR-06 | Tạo VietQR qua payOS/SePay | Ảnh QR có sẵn của tài khoản; khách nhập số tiền và nội dung là mã đơn | Quyết định thanh toán 29/10 | Sửa BA |
| FR-36, FR-01 | SMS OTP (Could); đăng nhập email/Google | Email + Google; số điện thoại nhận mã qua Zalo (tắt tới G6); không SMS | Quyết định đăng nhập 30/10 | Sửa BA |
| FR-18, BR-17 | Cấp khóa thủ công cho đơn cần xử lý tay | Tách hai thao tác: “ghép với đơn” bắt buộc chọn giao dịch có trong sổ; “cấp không thu tiền” có lý do, chỉ chủ, không đổi đơn | Quyết định 29/10, CLAUDE.md | Sửa BA |
| BR-02 | Chỉ webhook có chữ ký mới đổi đơn sang đã thanh toán | Webhook có chữ ký, **hoặc** đối soát API SePay, **hoặc** dòng sao kê nhập tay đã được chủ xác minh rồi ghép | CLAUDE.md (bất biến thanh toán) | Sửa BA |
| BR-03 | Mở khóa tự động khi đúng số tiền và đơn còn hạn | Như BA, nhưng “còn hạn” tính theo giờ ngân hàng (cho lệch sớm 60 giây); tiền chuyển trong hạn báo về muộn vẫn mở khóa | Quyết định 29/10 | Sửa BA (thêm chi tiết) |
| Mục 9, BR-09 | 5 trạng thái đơn; hoàn tiền **xóa** bản ghi enrollments | 4 trạng thái tài chính; “cần xử lý tay” là cờ suy ra từ hàng chờ; hoàn tiền **thu hồi** (giữ bản ghi, giữ tiến độ học) | DG §2.3, CLAUDE.md | Sửa BA |
| BR-05 | Mỗi học viên tối đa một bản ghi enrollments cho mỗi khóa | Có thể có nhiều bản ghi (một từ đơn, một từ cấp không thu tiền; tài khoản đã gộp); quyền học đọc theo nhóm gộp, có ít nhất một bản ghi còn hiệu lực là học được | Thiết kế gộp tài khoản 30/10 | Sửa BA, hoặc báo nếu anh muốn chặn trùng |
| NFR-09 | Audio, ảnh tải qua link có hạn | Tải qua API kiểm quyền theo phiên mỗi lần, không có link chia sẻ được; tệp công khai chỉ là marketing và 3 bài học thử | Quyết định media 30/10 | Sửa BA |
| FR-13 | Bài học: hội thoại có audio, phụ đề, thẻ từ vựng, bài kiểm tra | Nội dung Engine Cadet là bài phỏng vấn ba mức (câu hỏi, ý bắt buộc, từ vựng, đáp án mẫu, thẻ ôn); chưa có audio | Spec mục 8 điểm 5 | Bổ sung FR cho dạng bài này |
| FR-26 | Xin và lưu đồng ý: điều khoản, dữ liệu cá nhân, ghi âm | Có: đồng ý điều khoản mỗi đơn (bảng chỉ thêm, theo phiên bản). Chưa: đồng ý nhận tin quảng cáo (ô không tích sẵn trên màn đăng ký chưa làm), đồng ý ghi âm (chưa có ghi âm) | G12a chưa chốt | Anh chốt G12a; mã làm phần còn lại |

## Đã có trong mã

FR-02 (tối đa 2 máy, chọn máy để thay), FR-04 / BR-11 (3 bài học thử), FR-05 / BR-01 / BR-06 / BR-07 (giá từ máy chủ, hạn 15 phút, một đơn chờ mỗi khóa), FR-07 / BR-04 / NFR-11 (webhook có chữ ký, mỗi giao dịch xử lý một lần, gửi lại không trùng), FR-08, FR-09 (trang thanh toán tự cập nhật), FR-11 / FR-32 (Telegram kinh doanh và nhóm lỗi, cần token), FR-12, FR-14 / NFR-03 (học offline, tự đồng bộ), FR-17 (danh sách đơn, lọc), FR-19 (hoàn tiền theo bước, thu hồi quyền học), FR-22 phần tổng kết ngày qua Telegram, FR-27 (hết hạn đơn, gửi lại thông báo; đối soát chờ G4), FR-31 (nhật ký quản trị), BR-10, BR-12 (thông báo sau khi mở khóa, lỗi gửi không hỏng mở khóa), BR-18 phần “không hoàn quá số đã nhận”, NFR-05 (PWA; chưa thử Safari iPhone thật), NFR-06 (mua trong 3 bước), NFR-07, NFR-08, NFR-10 (tin Telegram không chứa số điện thoại), NFR-12 (sao lưu hằng ngày, mã hóa, đã thử khôi phục), NFR-14 (lưu mọi báo cáo webhook và mọi thông báo), NFR-17 (360px), NFR-18 (cổng thanh toán tách một module).

## Chờ anh (cổng hoặc nội dung)

| Mục | Chờ |
| --- | --- |
| FR-03 video giới thiệu | Video (khối đang ẩn) |
| FR-10 email xác nhận | Nhà cung cấp email (G7); mã đã xếp email vào hàng gửi |
| FR-21 Zalo cho học viên | G6, G15 |
| FR-24, FR-25, BR-08, BR-15 mã giảm giá, combo | G14 |
| FR-29 trang chính sách | Văn bản pháp lý (trang có, nội dung “Đang cập nhật”) |
| BR-09 mức hoàn tiền | G13 |
| FR-15, FR-34, FR-35, BR-13, BR-16 chấm phát âm, nhân vật, ghi âm | Để sau giai đoạn 1 (DG §10) |
| NFR-13 chi phí, NFR-15 sẵn sàng 99% | Chọn VPS (G8) |

## Chưa làm (không có quyết định hoãn)

| Mục | Ghi chú |
| --- | --- |
| FR-16 kiểm tra cuối khóa, chứng nhận; FR-30 tra cứu chứng nhận | Không nằm trong phạm vi DG §10; anh xác nhận để sau hay làm |
| FR-20 báo cáo doanh thu theo khóa | Có tiền nhận và tiền hoàn theo khoảng ngày; chưa tách theo khóa |
| FR-22 nhắc học, chuỗi ngày học | Chưa làm |
| FR-28 học viên gửi yêu cầu hoàn tiền trên web | Hiện qua trang Liên hệ, người hỗ trợ tạo yêu cầu |
| FR-33 analytics | Chưa làm |
| BR-18 hoàn về đúng tài khoản học viên khai | Yêu cầu hoàn chưa có ô tài khoản nhận tiền của học viên; chỉ ghi mã giao dịch chuyển trả |
| NFR-02, NFR-04 | Chưa đo tốc độ tải trang trên 4G; chưa chốt dung lượng tối đa mỗi bài |
| NFR-16 giữ log 12 tháng | Đơn, sổ giao dịch, nhật ký quản trị giữ vô hạn; nhật ký job giữ 30 ngày; bản sao lưu giữ 30 ngày. Cần hỏi kế toán về thời hạn theo luật |
