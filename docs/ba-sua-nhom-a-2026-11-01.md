# Nội dung sửa tab “Tài liệu BA”: nhóm A và các ghi chú đi kèm (01/11/2026)

Anh đã duyệt ngày 01/11: chỗ nào mã làm khác BA theo một quyết định đã có (nhóm A trong `docs/ba-doi-chieu-2026-11-01.md`) thì sửa BA cho khớp mã.
Doc BA (https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD) chưa chia sẻ cho tài khoản Claude đang làm, nên chưa sửa thẳng được. Dưới đây là chữ thay thế cho từng chỗ để dán vào doc, hoặc anh chia sẻ doc với tài khoản này để Claude sửa.

## Nhóm A: sửa BA cho khớp mã

| # | Chỗ cần sửa trong BA | Ghi lại thành | Căn cứ |
| --- | --- | --- | --- |
| 1 | FR-06; US-03 tiêu chí 1; mục 10 (biện pháp “QR có sẵn số tiền, tài khoản ảo theo đơn”) | Trang thanh toán hiện ảnh QR sẵn có của tài khoản ngân hàng chủ dự án, số tiền và mã đơn; khách tự nhập số tiền và nội dung chuyển khoản là mã đơn, có nút chép từng giá trị. SePay theo dõi tài khoản và gửi webhook có chữ ký. Không dùng payOS và tài khoản ảo ở giai đoạn 1. | Quyết định thanh toán 29/10 |
| 2 | FR-01, FR-36; mục 13 (OTP = SMS) | Học viên đăng ký và đăng nhập bằng **số điện thoại + mật khẩu** (cách chính trên màn đăng nhập, số chưa xác minh; quyết định D2 ngày 01/11), email (mã 6 số) hoặc Google; quên mật khẩu: mã tới email đã liên kết, hoặc chủ đặt mật khẩu tạm theo tiêu chí G15. Mã qua tin Zalo (ZNS) bật khi qua cổng G6. Không dùng SMS OTP vì trên tàu thường có Starlink nhưng không có sóng di động. Màn đăng nhập nói rõ mã Zalo chỉ tới số có dùng Zalo. | Quyết định đăng nhập 30/10 |
| 3 | FR-18, BR-17; US-09 (nguồn quyền học “thủ công”); UC-09 hậu điều kiện | Hai thao tác tách biệt. (a) Ghép với đơn: bắt buộc chọn một giao dịch đã xác minh trong sổ, chưa dùng; đơn sang “đã thanh toán”, quyền học nguồn “mua”, phân bổ loại “tay”. (b) Cấp không thu tiền: có lý do, chỉ chủ làm, không đổi trạng thái đơn nào. | Quyết định 29/10, DG §2.8 |
| 4 | BR-02; mục 9 (“chỉ hai đường vào đã thanh toán”) | Đơn chỉ thành “đã thanh toán” từ một giao dịch đã xác minh trong sổ, đến qua một trong ba đường: webhook SePay có chữ ký, đối soát API SePay có xác thực, hoặc dòng sao kê nhập tay đã được chủ xác minh rồi ghép. Trang “thành công” trên trình duyệt không bao giờ mở khóa. | CLAUDE.md, bất biến thanh toán |
| 5 | UC-03 ngoại lệ E4; TC-05 | Hạn đơn tính theo giờ ngân hàng của giao dịch, không theo lúc hệ thống nhận (cho lệch sớm 60 giây). Tiền chuyển trong 15 phút mà báo về muộn vẫn tự mở khóa, kể cả khi đơn đã bị đánh dấu hết hạn. Chỉ tiền chuyển sau hạn mới vào hàng “cần xử lý tay”. TC-05 kiểm cả hai trường hợp. | Quyết định 29/10 |
| 6 | Mục 9 (trạng thái đơn); UC-10 bước 5 và hậu điều kiện | Đơn có 4 trạng thái tài chính: chờ thanh toán, đã thanh toán, hết hạn, đã hoàn tiền. “Cần xử lý tay” là cờ suy từ hàng chờ giao dịch, không phải trạng thái. Hoàn tiền **thu hồi** quyền học của đơn (giữ bản ghi và tiến độ học để mua lại học tiếp), không xóa. | DG §2.3 |
| 7 | US-10 tiêu chí (một nút “Hoàn tiền và xác nhận đã chuyển trả”) | Bốn bước, mỗi bước ghi người làm và thời điểm: đề nghị → chủ duyệt (cần tài khoản nhận tiền, BR-18) → đã chuyển (mã giao dịch chuyển trả, duy nhất, và bằng chứng) → xác nhận. Đề nghị hoặc đã duyệt thì hủy được, có lý do; đã chuyển thì báo lỗi được. | DG §2.9, §5 |
| 8 | BR-05 | Một học viên có thể có nhiều bản ghi quyền học cho cùng một khóa (từ đơn, từ cấp không thu tiền, từ tài khoản đã gộp); được học khi còn ít nhất một bản ghi hiệu lực. Quyền học đọc theo nhóm gộp. | Thiết kế gộp tài khoản 30/10 |
| 9 | NFR-09; mục 10 (“link audio, ảnh có hạn”) | Tệp bài trả phí chỉ tải qua API kiểm quyền theo phiên ở mỗi lần tải; không có đường dẫn chia sẻ được. Tệp công khai chỉ gồm tài liệu quảng bá và 3 bài học thử của mỗi khóa. | Quyết định media 30/10 |
| 10 | FR-13; US-05 (bài kiểm tra, điểm) | Giai đoạn 1 dùng nội dung Engine Cadet: bài phỏng vấn ba mức (câu hỏi, ý bắt buộc, từ vựng, đáp án mẫu, thẻ ôn); audio thêm khi có. Bài kiểm tra có điểm để sau (đồng bộ đã nhận sự kiện bài kiểm tra nhưng giao diện chưa có). | Spec mục 8 điểm 5 |

## Ghi chú thêm vào BA từ nhóm B

Những chỗ dưới đây đã bàn ở nhóm B; Claude đề xuất ghi vào BA thay vì sửa mã. Anh xem lại.

| Chỗ trong BA | Đề xuất ghi | Lý do |
| --- | --- | --- |
| US-08 tiêu chí (tin Telegram có tên khách) | Tin đơn đã thanh toán có mã đơn, tên khóa, số tiền, giờ thanh toán (giờ Việt Nam); **không** có tên khách. | NFR-10 cấm đưa danh tính khách vào Telegram. Mã đã làm phần còn lại (01/11). |
| FR-17 (lọc đơn theo 5 trạng thái) | Lọc theo 4 trạng thái tài chính; đơn “cần xử lý tay” xem ở trang Sổ giao dịch. | Theo mục A dòng 6. |
| UC-03 luồng phụ A1 (đăng nhập xong quay lại trang khóa) | Đăng nhập từ nút mua thì quay lại thẳng trang mua của khóa đó. | Bớt một bước cho khách; Claude chưa đổi mã ở chỗ này. Anh muốn đúng như BA cũ thì báo, đổi mất vài phút. |
| UC-09 (hoàn số đã nhận khi khách chuyển thiếu); UC-10 điều kiện | Khoản chuyển nằm hàng chờ (thiếu tiền, sai mã, sau hạn, chuyển hai lần) hoàn được trọn từ trang Sổ giao dịch, không gắn đơn, cũng qua 4 bước và cần tài khoản nhận. | Mã đã làm 01/11. |
| UC-10 bước 3 | Hủy yêu cầu hoàn của một đơn thì gửi email báo chủ đơn kèm lý do (gửi thật khi qua G7). | Mã đã làm 01/11. |
