# Đối chiếu tab “Tài liệu BA” với mã nguồn (cổng G1) — 01/11/2026, bản rà lại

Nguồn: tab “Tài liệu BA” trong https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD (đủ 13 mục: phạm vi, use case, đặc tả UC-03/09/10, user story và tiêu chí nghiệm thu, FR, BR, NFR, trạng thái đơn, rủi ro, kiểm thử), so với nhánh `phase1` sau P1–P5 và bản cập nhật 01/11.
Bản đầu chỉ đọc mục 6–9; bản này đã được một người rà soát độc lập đọc toàn bộ tài liệu BA và đối chiếu lại từng dòng với mã (có số dòng). Tài liệu BA là nguồn chuẩn nên **không sửa ở đây**: anh quyết sửa BA hay sửa mã.

Ký hiệu: **Có** = mã đã làm đúng · **Khác** = mã làm khác BA theo một quyết định đã ghi · **Chờ** = chờ cổng hay nội dung của anh · **Chưa** = chưa làm, không có quyết định nào hoãn.

## A. Mã làm khác BA theo quyết định đã có (đề xuất: sửa BA)

| Mục BA | BA ghi | Mã đang làm | Căn cứ |
| --- | --- | --- | --- |
| FR-06; US-03 tiêu chí 1; mục 10 (biện pháp “QR có sẵn số tiền, tài khoản ảo theo đơn”) | Tạo VietQR có sẵn số tiền và mã đơn qua payOS/SePay | Ảnh QR có sẵn của tài khoản; khách tự nhập số tiền và nội dung là mã đơn, có nút chép | Quyết định thanh toán 29/10 |
| FR-01, FR-36; mục 13 (OTP = SMS) | Email/Google; SMS OTP | Email + Google; số điện thoại nhận mã qua Zalo (tắt tới G6); không SMS | Quyết định đăng nhập 30/10 |
| FR-18, BR-17; US-09 (nguồn quyền học “thủ công”); UC-09 hậu điều kiện | Cấp khóa thủ công cho đơn lỗi | Hai thao tác tách biệt: “ghép với đơn” bắt buộc chọn giao dịch đã xác minh trong sổ (quyền học nguồn “mua”, phân bổ loại “tay”); “cấp không thu tiền” có lý do, chỉ chủ, không đổi đơn | Quyết định 29/10, DG §2.8 |
| BR-02; mục 9 (“chỉ hai đường vào đã thanh toán”) | Chỉ webhook có chữ ký | Webhook có chữ ký, đối soát API SePay, hoặc dòng sao kê nhập tay đã được chủ xác minh rồi ghép | CLAUDE.md (bất biến thanh toán) |
| UC-03 ngoại lệ E4; TC-05; BR-03 | Đơn đã hết hạn mà tiền về → cần xử lý tay | Tính theo giờ ngân hàng (cho lệch sớm 60 giây): tiền chuyển **trong hạn** mà báo về muộn vẫn tự mở khóa; chỉ tiền chuyển **sau hạn** mới vào xử lý tay | Quyết định 29/10 |
| Mục 9; UC-10 bước 5 và hậu điều kiện | Hoàn tiền thì **xóa** quyền học; 5 trạng thái đơn | Hoàn tiền **thu hồi** quyền học (giữ bản ghi và tiến độ học, khớp chữ “thu hồi” của BR-09); 4 trạng thái tài chính, “cần xử lý tay” là cờ suy từ hàng chờ | DG §2.3, CLAUDE.md |
| US-10 tiêu chí (một nút “Hoàn tiền và xác nhận đã chuyển trả”) | Một bước | Bốn bước: đề nghị → chủ duyệt → đã chuyển (mã giao dịch, bằng chứng) → xác nhận | DG §2.9, §5 |
| BR-05 | Tối đa một bản ghi quyền học mỗi khóa | Có thể nhiều bản ghi (từ đơn, từ cấp không thu tiền, từ tài khoản đã gộp); quyền học đọc theo nhóm gộp | Thiết kế gộp tài khoản 30/10 |
| NFR-09; mục 10 (“link audio, ảnh có hạn”) | Link có hạn | Tải qua API kiểm quyền theo phiên mỗi lần, không có link chia sẻ được; tệp công khai chỉ là marketing và 3 bài học thử | Quyết định media 30/10 |
| FR-13; US-05 (bài kiểm tra, điểm) | Hội thoại có audio, phụ đề, thẻ từ vựng, bài kiểm tra | Nội dung Engine Cadet là bài phỏng vấn ba mức (câu hỏi, ý bắt buộc, từ vựng, đáp án mẫu, thẻ ôn); chưa audio; **chưa có bài kiểm tra và điểm** (đồng bộ đã nhận sự kiện bài kiểm tra nhưng giao diện chưa sinh ra) | Spec mục 8 điểm 5 (dạng bài khác) |

## B. Mã chưa khớp BA mà không có quyết định nào giải thích (đề xuất: sửa mã, trừ khi anh muốn sửa BA)

| Mục BA | BA ghi | Mã đang làm | Mức |
| --- | --- | --- | --- |
| UC-09 (khách chuyển thiếu → “hoàn lại số đã nhận”); UC-10 điều kiện (“đơn đã thanh toán **hoặc cần xử lý tay**”) | Hoàn được cả khoản chưa ghép vào đơn | **Không hoàn được** khoản đang nằm hàng chờ (thiếu tiền, sai mã, chuyển sau hạn, chuyển lần hai cho đơn đã trả): hoàn tiền bắt buộc gắn với đơn và chỉ lấy tiền đã ghép vào đơn đó; kết luận hàng chờ chỉ có “trùng” và “bỏ qua”. DG §2.1, §2.3, §2.8 lại nói khoản này phải hoàn được | **Quan trọng**: khách chuyển sai không có đường trả tiền trong hệ thống |
| FR-26; UC-01 | Đồng ý điều khoản, **dữ liệu cá nhân**, ghi âm | Có: đồng ý điều khoản + chính sách hoàn tiền mỗi đơn (bảng chỉ thêm, theo phiên bản). Chưa: đồng ý dữ liệu cá nhân lúc đăng ký (ô ở bước mua chưa nêu chính sách bảo mật); ghi âm chưa có | Chờ G12a cho nội dung; mã nhỏ |
| UC-10 bước 2 và ngoại lệ | Kiểm điều kiện BR-09, gắn cờ “ngoài chính sách” | Không kiểm, không gắn cờ; người duyệt tự xem | Mức hoàn chờ G13; cờ thì làm được ngay khi chốt |
| UC-10 bước 3 | Từ chối thì email báo học viên | Hủy yêu cầu có lý do nhưng không báo học viên | Nhỏ; email chờ G7 |
| US-08 tiêu chí | Tin Telegram đơn đã thanh toán có mã đơn, tên khách, khóa, số tiền, thời gian | Chỉ có mã đơn và số tiền | Nhỏ |
| US-04 tiêu chí; FR-10 | Email xác nhận có tên khóa, số tiền, mã đơn, link vào app | Có mã đơn, số tiền; thiếu tên khóa và link vào app | Nhỏ; gửi thật chờ G7 |
| UC-03 luồng phụ A3 | Đã có khóa thì trang khóa ẩn nút Mua, hiện Vào học | Trang chi tiết khóa vẫn hiện “Mua khóa học”; chỉ trang mua mới chuyển sang “Vào học” | Nhỏ |
| UC-03 luồng phụ A1 | Đăng nhập xong quay lại trang khóa | Quay lại trang mua của khóa đó | Rất nhỏ (đi thẳng tới bước tiếp theo) |
| FR-17 | Lọc đơn theo trạng thái (5 trạng thái) | Lọc theo 4 trạng thái tài chính; “cần xử lý tay” ở trang Sổ giao dịch | Theo quyết định ở mục A; chỉ cần ghi rõ |
| FR-20; US-11 | Báo cáo theo ngày, theo khóa, có số hoàn | Có tiền nhận, tiền hoàn, theo khóa (01/11) trong hôm nay / 7 / 30 ngày; chưa chọn khoảng ngày tự do; số đơn hoàn chưa tách theo khóa | Nhỏ |
| NFR-14 | Ghi log mọi webhook | Lưu mọi báo cáo **đã xác thực**; webhook sai chữ ký hay sai dạng chỉ ghi log máy chủ, không vào DB | Nhỏ; cảnh báo chữ ký sai tăng bất thường đã hoãn tới G4 |

## C. Đã có trong mã

FR-02 (tối đa 2 máy, chọn máy để thay), FR-04 / BR-11 (3 bài học thử), FR-05 / BR-01 / BR-06 / BR-07, FR-07 / BR-04 / NFR-11, FR-08, FR-09 (trang thanh toán tự cập nhật), FR-11 / FR-32 (Telegram kinh doanh và nhóm lỗi, cần token; nội dung xem mục B), FR-12, FR-14 / NFR-03 (học offline, tự đồng bộ), FR-19, FR-20 phần theo khóa, FR-22 phần tổng kết ngày, FR-27 (đối soát chờ G4), **FR-28 (học viên tự gửi yêu cầu hoàn tiền trên trang Tài khoản, 01/11)**, FR-31, BR-10, BR-12, **BR-18 (tài khoản nhận tiền hoàn bắt buộc trước khi duyệt, khóa sau khi duyệt; không hoàn quá số đã nhận, 01/11)**, NFR-06 (mua 3 bước), NFR-07, NFR-08, NFR-10 (tin Telegram không có số điện thoại hay danh tính khách), NFR-18.

Cần ghi chú thêm:
- **NFR-05:** có PWA; chưa thử Safari trên iPhone thật.
- **NFR-12:** sao lưu hằng ngày mã hóa, đã thử khôi phục **trên máy phát triển**; chưa có nơi lưu ngoài, chưa thử trên máy khác (G8).
- **NFR-17:** trang bán hàng, thanh toán, quản trị kiểm ở 360px; app học `/hoc` chưa kiểm tự động ở 360px.

## D. Chờ anh

| Mục | Chờ |
| --- | --- |
| FR-03 video giới thiệu | Video. Trang khóa hiện **chưa có khối video** (không phải đang ẩn) |
| FR-10 email xác nhận | Nhà cung cấp email (G7); mã đã xếp email vào hàng gửi |
| FR-21 Zalo cho học viên | G6 và mẫu tin ZNS riêng |
| FR-24, FR-25, BR-08, BR-15 mã giảm giá, combo | G14 |
| FR-29 trang chính sách | Văn bản pháp lý (trang có, nội dung “Đang cập nhật”) |
| BR-09 mức hoàn | G13 |
| FR-15, FR-34, FR-35, BR-13, BR-16 chấm phát âm, nhân vật, ghi âm | Để sau giai đoạn 1 (DG §10) |
| NFR-01 mở khóa trong 10 giây | Mã xử lý webhook đồng bộ (giới hạn 8 giây); đo thật khi có SePay (G4) |
| NFR-13 chi phí, NFR-15 sẵn sàng 99% | Chọn VPS (G8) |
| BR-14 không dùng tên tàu, tên công ty thật | Quy tắc nội dung: cần duyệt nội dung Engine Cadet (chưa duyệt) |
| Mục 12: TC-01 (cần email), TC-08 (cần mã giảm giá), “đã gắn theo dõi truy cập” (FR-33) | G7, G14, FR-33 |

## E. Hoãn sau giai đoạn 1 (anh chốt 01/11)

FR-16 kiểm tra cuối khóa và chứng nhận, FR-30 tra cứu chứng nhận, FR-22 nhắc học và chuỗi ngày học, FR-33 analytics. FR-23 ngoài phạm vi theo BA. NFR-02 (đo tốc độ 4G) và NFR-04 (dung lượng tối đa mỗi bài) chưa đo, chưa chốt. NFR-16: đơn, sổ giao dịch, nhật ký quản trị, báo cáo webhook, outbox giữ vô hạn; nhật ký job 30 ngày; bản sao lưu 30 ngày; thời hạn theo luật cần hỏi kế toán.

## Những gì bản đầu ghi sai (đã sửa ở bản này)

- FR-26: bản đầu nói thiếu đồng ý “nhận tin quảng cáo”; BA không đòi việc đó, cái thiếu thật là đồng ý **dữ liệu cá nhân**.
- Mục 9 / BR-09: chữ “xóa quyền học” nằm ở mục 9 và UC-10, còn BR-09 ghi “thu hồi” đúng như mã.
- BR-03: chỗ lệch thật là UC-03 E4 và TC-05, không phải BR-03.
- FR-03: không có khối video bị ẩn; trang chưa có khối video.
- FR-21: liên quan G6 và mẫu ZNS, không liên quan G15.
- NFR-12, NFR-14, FR-11, FR-13 được ghi chính xác hơn; bỏ sót NFR-01, BR-14, FR-23 nay đã thêm.
- Bỏ sót quan trọng nhất: **khoản chuyển nằm hàng chờ không hoàn được** (mục B dòng đầu).

## Sau khi anh duyệt (01/11): đã làm gì

Anh chốt: nhóm A sửa BA, nhóm B sửa mã.

- **Nhóm A:** chữ thay thế cho 10 chỗ nằm ở `docs/ba-sua-nhom-a-2026-11-01.md`. Doc BA chưa chia sẻ cho tài khoản Claude đang làm nên chưa dán thẳng vào được.
- **Nhóm B, đã sửa mã:**

| Mục | Commit |
| --- | --- |
| Hoàn khoản chuyển nằm hàng chờ (UC-09, UC-10) | `f5dea61` |
| Tin Telegram đơn đã trả có khóa và giờ (US-08, không tên khách theo NFR-10); email có tên khóa và link vào app (US-04, FR-10); từ chối hoàn thì email báo học viên kèm lý do (UC-10 bước 3); trang khóa hiện “Vào học” khi đã có khóa (UC-03 A3) | `b02e7f9` |
| Báo cáo theo khoảng ngày tự chọn, số hoàn theo khóa (FR-20, US-11) | `64e1571` |

- **Nhóm B, ghi vào BA thay vì sửa mã:** FR-17 (lọc 4 trạng thái), UC-03 A1 (đăng nhập xong quay thẳng về trang mua). Xem file trên.
- **Nhóm B, còn chờ:** FR-26 đồng ý dữ liệu cá nhân (chờ nội dung G12a), UC-10 cờ “ngoài chính sách” (chờ mức hoàn G13), NFR-14 lưu cả webhook sai chữ ký (hoãn tới G4).
