# Cổng thiết kế trước khi viết thiết kế kỹ thuật và plan giai đoạn 1

Soạn 30/10/2026 sau vòng review đối kháng với Codex (`/codex-plan-review`). Tài liệu này gồm: quy tắc ưu tiên nguồn,
sổ quyết định (cái gì còn mở, ai quyết, có chặn không), và các **yêu cầu bắt buộc** mà thiết kế kỹ thuật phải đáp ứng.
Mục “Đề xuất” là đề xuất kỹ thuật của Claude, chờ chủ dự án duyệt; mục “Chốt” là quyết định đã có của chủ dự án.

**Mỗi cổng chỉ chặn đúng phạm vi ghi ở cột “Chặn”.** Ngoại lệ do chủ dự án quyết ngày 30/10/2026: **G2 hoãn** — được code giai đoạn 1 trước,
Spec và giao diện cập nhật trước ra mắt. Vì vậy, khi G1 và G12a còn mở: được làm các task của plan P1 (nền tảng, phiên, OTP với email giả lập, Google, thiết
bị, liên kết định danh, quản trị) với giá trị đề xuất đặt thành cấu hình; **không** chốt thiết kế kỹ thuật cuối, **không** bật dịch vụ thật của các cổng nhà
cung cấp (G4 SePay, G6 Zalo, G7 email) và **không** ra mắt. Bảng và log dữ liệu cá nhân được tạo, nhưng thời hạn lưu và xóa chốt ở G12a trước ra mắt.

## 0. Quy tắc ưu tiên nguồn (ISSUE-1)

1. Tài liệu đặc tả Claude Docs là nguồn sự thật về yêu cầu, **trừ** những điểm đã có quyết định ghi ngày trong CLAUDE.md sau ngày
   tài liệu đặc tả được sửa lần cuối: quyết định có ngày mới hơn thắng, cho tới khi được đối chiếu và ghi lại vào tài liệu đặc tả.
2. Cổng G1 (bên dưới): khôi phục quyền đọc tài liệu đặc tả, lập bảng đối chiếu từng yêu cầu (UC/FR/NFR/BR/test case) với các quyết định
   29–30/10, giải quyết mọi mâu thuẫn với chủ dự án. Chỉ sau đó mới chốt thiết kế kỹ thuật.

## 1. Sổ quyết định và cổng

| ID | Việc | Ai quyết | Chặn | Trạng thái |
| --- | --- | --- | --- | --- |
| G1 | Đọc tài liệu đặc tả, đối chiếu từng yêu cầu với quyết định 29–30/10, xử lý 9 điểm lệch | Chủ dự án + Claude | **Chặn thiết kế cuối** | Mở (thiếu quyền đọc) |
| G2 | Cập nhật tab Spec theo `docs/spec-v1-changes-2026-10-30.md` + mục 2–9 dưới đây, chủ dự án duyệt, sửa bảng, chụp và rà lại giao diện | Chủ dự án + Claude | **Chặn giai đoạn 1** (điều kiện ra khỏi giai đoạn 0) | **Hoãn 30/10/2026**: chủ dự án cho code giai đoạn 1 trước, cập nhật Spec + giao diện sau (G2 vẫn phải đóng trước ra mắt) |
| G3 | Phạm vi giai đoạn 1: những gì có / để sau (đề xuất ở mục 10) | Chủ dự án | **Chặn plan giai đoạn 1** | **Đóng 30/10/2026**: đồng ý đề xuất mục 10 |
| G4 | SePay: gói, tài khoản ngân hàng liên kết, quyền gọi API đối soát, kiểu xác thực HMAC, quy tắc nhận diện mã thanh toán; thử webhook thật bằng số tiền nhỏ | Chủ dự án | **Chặn phần thanh toán** | Mở |
| G5 | Mã đơn: xác nhận `ME` + 8 ký tự, khớp quy tắc nhận diện của SePay (G4) | Chủ dự án | Chặn phần thanh toán | Đề xuất |
| G6 | Zalo OA đã xác thực, mẫu ZNS gửi mã được duyệt, chi phí mỗi tin, hạn mức ngân sách tháng; có dùng chung OA/đối tác của Cole không | Chủ dự án | **Chặn đăng nhập bằng mã Zalo** gửi tới số điện thoại (email/Google và số + mật khẩu vẫn làm được, xem D2) | Mở |
| G7 | Nhà cung cấp email (Resend hoặc Brevo), tên miền gửi | Chủ dự án | Chặn đăng nhập email, thông báo | Mở |
| G8 | VPS: nhà cung cấp, cấu hình, người vận hành, mục tiêu khôi phục (mục 8) | Chủ dự án | **Chặn triển khai** | Mở |
| G9 | Thời hạn học offline và thời gian ân hạn (mục 6) | Chủ dự án | **Chặn thiết kế offline** | Đề xuất |
| G10 | Định nghĩa thiết bị và cách đổi thiết bị (mục 6) | Chủ dự án | Chặn thiết kế phiên học viên | Đề xuất |
| G11 | Ma trận quyền quản trị (mục 5) | Chủ dự án | Chặn trang quản trị | Đề xuất |
| G12a | Kiến trúc dữ liệu cá nhân: bảng dữ liệu thu thập, mục đích, bên xử lý, mô hình đồng ý, thời hạn lưu từng loại, cách xóa/ẩn danh, ngoại lệ sao lưu (mục 9) | Chủ dự án + Claude | **Chặn thiết kế dữ liệu cuối** và phần code liên quan (schema, log, job xóa, xuất dữ liệu, xóa tài khoản) | Mở |
| G12b | Văn bản pháp lý cuối, thông tin hộ kinh doanh, liên hệ | Chủ dự án (+ kế toán/pháp lý) | Chặn ra mắt | Mở |
| G15 | Chính sách tài khoản chỉ có số điện thoại: chấp nhận rủi ro số bị cấp lại hay bắt buộc liên kết thêm email/Google; tiêu chí khôi phục qua hỗ trợ (mục 3) | Chủ dự án | Chặn đăng nhập bằng **mã gửi tới số** (Zalo). Không chặn số + mật khẩu (D2): người được cấp lại số không có mật khẩu | Đề xuất |
| G13 | Chính sách hoàn tiền (đề xuất 100% trong 7 ngày nếu học dưới 3 bài), cách hoàn (chuyển khoản tay) | Chủ dự án | Chặn ra mắt | Mở |
| G14 | Giá bán, combo, mã giảm giá | Chủ dự án | Chặn ra mắt | Mở |

| D2 | Học viên đăng ký và đăng nhập bằng **số điện thoại + mật khẩu**, thêm vào bên cạnh email và Google | Chủ dự án | — | **Quyết 01/11/2026** |

D2 (01/11/2026, chủ dự án chọn trong phiên làm việc): số điện thoại **chưa xác minh** khi đăng ký (chưa có SMS, mã Zalo chờ G6), lưu riêng ở
`password_logins`, không bao giờ coi là danh tính đã xác minh (`user_identities`). Quên mật khẩu: mã tới email đã liên kết; đặt lại tay theo
tiêu chí khôi phục của G15 (chỉ chủ, có lý do và bằng chứng như mã đơn, giao dịch, hồ sơ; có nhật ký); mã Zalo khi xong G6. Dữ liệu mới
(G12a): băm mật khẩu giữ cùng tài khoản; `password_attempts` (IP, số, đúng/sai) giữ 30 ngày như `otp_send_log`, có job dọn.
Kế hoạch: `docs/superpowers/plans/2026-11-01-phone-password.md`.

Mỗi cổng khi đóng ghi: ngày, lựa chọn, lý do, bằng chứng (ảnh webhook thử, ảnh mẫu ZNS được duyệt, bản khôi phục thử…).

## 2. Thanh toán (ISSUE-3 → 12)

### 2.0 Nguồn xác nhận thanh toán và bảng dữ liệu (ISSUE-29, 30)
- Đơn chỉ thành **Đã thanh toán** từ một giao dịch tiền vào **đã được xác minh** trong `bank_transactions`, đến bằng một trong ba đường:
  webhook SePay có chữ ký hợp lệ; đối soát qua API SePay có xác thực; hoặc ghép tay có nhật ký (mục 2.8) với một dòng sổ đã nhập đúng quy
  trình (mục 2.1). “Cấp không thu tiền” không bao giờ đổi trạng thái đơn.
- `bank_transactions` là **nơi duy nhất** nhận và chống trùng giao dịch. **Khóa định danh chuẩn** không phụ thuộc đường đến (ISSUE-41):
  (ngân hàng, số tài khoản nhận, mã tham chiếu giao dịch của ngân hàng), ràng buộc duy nhất. Mã của SePay chỉ là thuộc tính phụ. Giao dịch
  đã nhập tay rồi sau đó SePay báo tới (webhook hoặc đối soát) thì **bổ sung và xác minh dòng cũ**, không tạo dòng mới; nếu số tiền hoặc thời
  điểm lệch nhau thì cảnh báo cho chủ, không tự sửa. Kiểm thử ở G4: SePay có trả mã tham chiếu ngân hàng không, và khớp với sao kê thế nào. Bảng `payments` trong kế hoạch cũ được thay bằng `payment_allocations` (dòng sổ ↔ đơn, mỗi dòng sổ phân bổ tối đa
  một lần, ràng buộc duy nhất) — không lặp lại mã giao dịch ở bảng khác. Tiền ra (hoàn tiền) ở bảng `refunds` (mục 2.9).

### 2.1 Sổ giao dịch ngân hàng (ISSUE-3, 32)
- Bảng `bank_transactions` chỉ chứa **sự thật bất biến** của giao dịch tiền vào (ngoại lệ duy nhất: bổ sung thông tin từ nguồn sau và dấu
  xác minh, có nhật ký):
  mã tham chiếu giao dịch (**duy nhất** theo 2.0), tài khoản nhận, số tiền, đơn vị tiền, nội dung gốc, thời điểm giao dịch ngân hàng,
  thời điểm nhận, nguồn (webhook / đối soát API / **nhập tay từ sao kê**), dữ liệu gốc.
- **Nhập tay từ sao kê** (dùng khi SePay chưa sẵn sàng hoặc bỏ sót): bắt buộc tài khoản nhận, số tiền, thời điểm giao dịch, mã tham chiếu
  ngân hàng, ảnh/sao kê làm bằng chứng, người nhập; kiểm tra trùng như mọi nguồn khác; dòng nhập tay ở trạng thái “chờ xác minh” cho tới khi
  **chủ** xác minh (người nhập không tự xác minh). Chỉ dòng đã xác minh mới được ghép với đơn.
- Trạng thái phân bổ **không lưu trong `bank_transactions`** (ISSUE-40) mà **suy ra** từ các bảng có nhật ký: `payment_allocations`
  (đã phân bổ cho đơn X), `bank_transaction_dispositions` (`trùng`, `bỏ qua` kèm lý do), `refunds` (đã hoàn). Không có bản ghi nào → `chưa phân bổ`.
  Mỗi dòng sổ có tối đa một phân bổ hoặc một kết luận đang hiệu lực (ràng buộc duy nhất); đổi kết luận bằng bản ghi mới có nhật ký.
- “Cần xử lý tay” là **hàng chờ giao dịch** (chưa phân bổ hoặc không khớp), không chỉ là trạng thái đơn: giao dịch không có mã đơn
  vẫn hiện để admin ghép với đơn.

### 2.2 Ảnh chụp đơn bất biến (ISSUE-8)
- Khi tạo đơn, máy chủ ghi cố định: khóa học + phiên bản, giá gốc, mã giảm giá (nếu có), số tiền giảm, **số tiền phải trả**, đơn vị,
  phiên bản chính sách hoàn tiền, `created_at`, `expires_at = created_at + 15 phút`. Không sửa sau khi tạo.
- Mã giảm giá (ISSUE-31): kiểm tra và giữ chỗ khi tạo đơn; trừ lượt khi đơn được thanh toán (trong cùng transaction với chuyển trạng thái);
  **giữ chỗ thêm 45 phút sau `expires_at`** (dài hơn chu kỳ SePay gửi lại ~33 phút) rồi mới trả lại lượt. Nếu sau đó vẫn có giao dịch hợp lệ
  trong hạn (đối soát muộn): vẫn chấp nhận giá trong ảnh chụp đơn, cho phép vượt hạn mức mã và ghi lại lần vượt.

### 2.3 Phân loại giao dịch và chuyển trạng thái (ISSUE-4, 7)
Thời gian (ISSUE-44): **mọi đường đến** (webhook, đối soát API, nhập tay từ sao kê) dùng cùng thời điểm giao dịch ngân hàng, cùng bộ phân
loại này; thời điểm nhận hay thời điểm xác minh **không bao giờ** quyết định còn hạn hay không. Chuẩn hóa về UTC; khoảng hợp lệ
`created_at <= bank_time < expires_at`. Trường thời gian lấy đúng trường của SePay (xác nhận ở G4) hoặc dòng sao kê. Thời gian giao dịch sai định dạng, ở tương lai quá 5 phút so với giờ máy chủ, hoặc thiếu → không tự xác nhận,
đưa vào hàng chờ.

| Giao dịch | Đơn đang | Kết quả |
| --- | --- | --- |
| Có đúng một mã đơn hợp lệ, **một** giao dịch, **đúng** số tiền, trong khoảng hợp lệ | Chờ thanh toán hoặc Hết hạn | **Tự xác nhận**: đơn → Đã thanh toán, tạo quyền học, giao dịch → đã phân bổ |
| Như trên nhưng thời gian giao dịch sau `expires_at` | Hết hạn | Hàng chờ (tiền về sau hạn) |
| Thiếu tiền, thừa tiền, hoặc nhiều giao dịch cộng lại mới đủ | bất kỳ | Hàng chờ; không tự cộng dồn |
| Không có mã, mã không tồn tại, nhiều mã | — | Hàng chờ (chưa phân bổ) |
| Giao dịch thứ hai cho đơn đã thanh toán | Đã thanh toán (**giữ nguyên**) | Hàng chờ (khả năng chuyển trùng, cần hoàn) |
| Giao dịch cho đơn đã hoàn tiền | Đã hoàn tiền (**giữ nguyên**) | Hàng chờ |
| Cùng mã giao dịch gửi lại | — | Không làm gì, trả thành công (idempotent) |

**Chốt đề xuất:** chỉ một giao dịch đơn lẻ, đúng số tiền, đúng một mã đơn, trong hạn mới tự xác nhận. Mọi trường hợp khác do người quyết.

**Trạng thái đơn tách khỏi việc cần xử lý tay (ISSUE-35, đề xuất):** trạng thái tài chính của đơn chỉ còn `chờ thanh toán`, `đã thanh toán`,
`hết hạn`, `đã hoàn tiền`. “Cần xử lý tay” là **cờ suy ra** khi đơn có giao dịch chưa xử lý trong hàng chờ, hiển thị trên giao diện như hiện nay
nhưng không thay trạng thái tài chính; giao dịch đến thêm không bao giờ thay `đã thanh toán` hay `đã hoàn tiền`. Chuyển hợp lệ:
chờ → đã thanh toán | hết hạn; hết hạn → đã thanh toán (giao dịch trong hạn đến muộn, hoặc ghép tay); đã thanh toán → đã hoàn tiền.
Thay đổi so với “5 trạng thái” trong kế hoạch: cần chủ dự án duyệt và ghi vào tài liệu đặc tả (G1).

### 2.4 Tính nguyên tử (ISSUE-5)
Một transaction ngắn duy nhất: ghi `bank_transactions` (ràng buộc duy nhất) → khóa dòng đơn (`SELECT … FOR UPDATE`) → phân loại theo bảng
2.3 → chuyển trạng thái hợp lệ → tạo quyền học → ghi sự kiện vào outbox (2.6). Xung đột ràng buộc duy nhất = đã xử lý, trả thành công.
Hoàn tiền và cấp tay dùng cùng khóa dòng đơn, nên không chạy chồng với webhook.

**Ghép nhiều giao dịch (chuyển bù, ISSUE-42):** trong một transaction: khóa dòng đơn và **mọi** dòng sổ tham gia (theo thứ tự id cố định để
tránh khóa chéo) → kiểm tra từng dòng đã xác minh và còn `chưa phân bổ` → kiểm tra tổng **đúng bằng** số tiền phải trả → tạo tất cả
`payment_allocations` → chuyển đơn sang Đã thanh toán → tạo quyền học → ghi outbox. Sai bất kỳ bước nào thì hủy cả transaction.

### 2.5 Hợp đồng webhook SePay (ISSUE-6) — điền ở G4 từ tài liệu SePay, không đoán
Thiết kế phải ghi rõ và có test cho: đọc **byte gốc** của body trước khi parse; chuỗi được ký và định dạng header (`X-SePay-Signature`,
`X-SePay-Timestamp`) đúng như tài liệu SePay; so sánh chữ ký thời gian hằng; cửa sổ timestamp (đề xuất ±5 phút) và máy chủ đồng bộ NTP;
chỉ nhận giao dịch **tiền vào**, đúng **tài khoản nhận** đã cấu hình, đúng đơn vị VND; bí mật lưu ngoài mã nguồn, có quy trình đổi bí mật
(chấp nhận hai bí mật trong thời gian chuyển); nếu SePay công bố dải IP thì thêm danh sách cho phép.

### 2.6 Outbox thông báo (ISSUE-11)
Bảng outbox ghi trong cùng transaction mở khóa, khóa chống trùng theo `(sự kiện, kênh)`; tiến trình gửi chạy **sau commit**, thử lại
có giãn cách, ghi lỗi cuối cùng và hiện trên trang quản trị. Gửi lỗi không bao giờ đụng tới quyền học. Telegram không trùng nhờ khóa outbox.

### 2.7 Đối soát (ISSUE-12)
Dùng chung bộ phân loại 2.3 với webhook. Cần ở G4: SePay có API liệt kê giao dịch không, phân trang, giới hạn gọi. Lưu con trỏ bền,
mỗi lần quét chồng lấn một khoảng (đề xuất 2 giờ) để không sót; khi máy chủ ngừng lâu thì quét bù từ con trỏ. Cảnh báo khi đối soát
lỗi hoặc tìm thấy giao dịch webhook bỏ sót. Tần suất (đề xuất 1 giờ) chốt theo mức chậm trễ chấp nhận được.

### 2.8 Hai loại thao tác cấp quyền tay (ISSUE-9)
| Thao tác | Bắt buộc | Kết quả |
| --- | --- | --- |
| **Ghép tiền** (giao dịch ngân hàng ↔ đơn) | Mã giao dịch ngân hàng chưa dùng, có trong `bank_transactions` hoặc nhập tay kèm ảnh/sao kê | Đơn → Đã thanh toán, quyền học nguồn “mua” |
| **Cấp không thu tiền** (học thử nội bộ, tặng, hỗ trợ, chuyển dữ liệu) | Lý do và loại, quyền riêng (mục 5) | Quyền học nguồn “tặng/nội bộ”, **không** tạo hay đổi đơn |
Cả hai ghi `admin_audit_log` với giá trị trước/sau. Quản trị muốn học: tạo tài khoản học viên, nhận quyền bằng “cấp không thu tiền”.

**Loại ghép tay và ai được làm (ISSUE-33, đề xuất, duyệt cùng G11):**

| Loại | Điều kiện | Ai được | Ghi lại |
| --- | --- | --- | --- |
| Đúng số tiền, thiếu/sai mã đơn | Dòng sổ đã xác minh, khách xác nhận qua liên hệ | Hỗ trợ | Cách xác định khách (ví dụ ảnh chuyển khoản) |
| Đúng số tiền, đến sau hạn | Như trên | Hỗ trợ | Thời điểm giao dịch so với hạn |
| Thiếu tiền | Không cấp; đề nghị khách chuyển bù rồi ghép **cả hai** giao dịch, hoặc hoàn | **Chủ** | Số thiếu, cách xử lý |
| Thừa tiền | Được cấp; **bắt buộc** tạo bản ghi hoàn phần thừa (2.9) | Hỗ trợ cấp, chủ duyệt hoàn | Số thừa |
| Tiền không liên quan / không xác định được người | Đánh dấu `bỏ qua` hoặc chờ liên hệ | **Chủ** | Lý do |
Mọi lần ghép tay ghi người làm, chênh lệch và bằng chứng.

### 2.9 Quyền học có nguồn gốc, hoàn tiền (ISSUE-10)
- Mỗi quyền học ghi nguồn: đơn X (mua) / cấp không thu tiền (lý do). Một người có thể có nhiều nguồn cho cùng một khóa; được học nếu
  còn ít nhất một quyền hiệu lực.
- Bảng `refunds` (tiền ra, ISSUE-34): đơn, dòng sổ tiền vào gốc, số tiền, lý do, trạng thái `đề nghị → đã duyệt → đã chuyển → đã xác nhận`
  (hoặc `lỗi`/`hủy`), mã tham chiếu ngân hàng của lần chuyển trả (**duy nhất**), bằng chứng, người đề nghị/duyệt/xác nhận, thời điểm từng bước.
  Sửa sai: không sửa dòng cũ, tạo bản ghi điều chỉnh có nhật ký.
- Hoàn tiền toàn phần: khi `refunds` chuyển sang `đã xác nhận`, trong một transaction: đơn → Đã hoàn tiền, **thu hồi đúng quyền học sinh ra
  từ đơn đó**, dòng sổ gốc → đã hoàn. Tiến độ học **giữ lại** (không xóa), để mua lại thì học tiếp. Hoàn phần thừa (2.8) không đổi trạng thái đơn.
- Hoàn một phần: không hỗ trợ ở giai đoạn 1 (ghi vào G13).
- Quy tắc CLAUDE.md “refund must delete the enrollment” hiểu là thu hồi quyền học của đơn đó trong cùng bước.

## 3. Đăng nhập học viên và OTP (ISSUE-13, 14, 15)

- **Email học viên (đề xuất):** mã 6 số gửi qua email, cùng vòng đời OTP như Zalo (màn `Login` đang hiển thị ô mã 6 số). Quản trị dùng
  link email riêng (mục 5). Chờ duyệt ở G3/G7.
- **Vòng đời OTP bắt buộc (Zalo và email):** sinh bằng CSPRNG; chỉ lưu **HMAC có khóa bí mật của máy chủ** (pepper lưu ngoài DB),
  vì băm thường của 1 triệu giá trị 6 số dò lại được ngay nếu lộ DB (ISSUE-36); so sánh thời gian hằng; đổi khóa thì mã cũ hết hiệu lực; hết hạn 5 phút; gắn với **mục đích** (đăng ký / đăng nhập /
  liên kết) và **định danh**; dùng một lần, tiêu thụ nguyên tử; tối đa 5 lần nhập sai thì hủy mã; gửi mã mới làm mã cũ mất hiệu lực;
  khoảng chờ giữa hai lần gửi (đề xuất 60 giây); giới hạn theo định danh (đề xuất 10 lần/24 giờ), theo IP, và **ngân sách ZNS toàn hệ thống**
  mỗi ngày; phản hồi trung tính (không lộ số/email đã có tài khoản hay chưa); nhật ký không chứa mã.
- **Số điện thoại:** nhận `0…`, `84…`, `+84…`, có khoảng trắng/dấu chấm/gạch; kiểm tra là số di động Việt Nam hợp lệ; lưu dạng chuẩn
  `+84…` và **duy nhất** trong DB; đổi sang định dạng nhà cung cấp ZNS yêu cầu ngay ở lớp gửi (Cole dùng dạng `0…`); hiển thị che bớt.
  Số nước ngoài: không hỗ trợ đăng nhập bằng số ở giai đoạn 1 (dùng email/Google).
- **Tài khoản chỉ có số điện thoại và rủi ro số bị cấp lại (ISSUE-37, cổng G15):** số bị nhà mạng cấp lại cho người khác thì người mới đăng
  nhập được vào tài khoản cũ. Đề xuất:
  - khuyến khích (không bắt buộc) liên kết thêm email/Google sau lần mua đầu;
  - đăng nhập từ thiết bị mới → báo qua mọi kênh đã liên kết khác;
  - thao tác nhạy cảm (đổi/gỡ cách đăng nhập, gộp, xóa tài khoản) cần xác thực lại và chờ 24 giờ trước khi có hiệu lực, có báo tới các kênh khác;
  - khôi phục qua hỗ trợ khi mất số: chứng minh bằng mã đơn + giao dịch chuyển khoản đã mua + thông tin hồ sơ, chủ duyệt, có nhật ký;
  - **rủi ro còn lại** (tài khoản chỉ có số điện thoại có thể bị người nhận lại số chiếm) phải được chủ dự án chấp nhận bằng văn bản ở G15,
    hoặc chủ dự án quyết định bắt buộc liên kết thêm email/Google.

## 4. Liên kết và gộp tài khoản (ISSUE-16)

- Mỗi định danh (số điện thoại, email, Google subject) **duy nhất toàn hệ thống**, chỉ thuộc một tài khoản.
- Liên kết thêm: phải đăng nhập gần đây (đề xuất trong 10 phút, nếu không thì xác minh lại), xác minh định danh mới bằng OTP/Google.
  Định danh đã thuộc tài khoản khác → **chặn**, hướng dẫn liên hệ hỗ trợ để gộp.
- Gỡ liên kết: không được gỡ cách đăng nhập cuối cùng.
- Gộp (admin): xem trước; trong một transaction chuyển định danh, tạo tiến độ cho tài khoản đích (theo tiến độ cao nhất từng bài), hồ sơ
  (giữ của tài khoản đích, ghi lại phần khác); tài khoản nguồn bị khóa và trỏ về tài khoản đích, thu hồi mọi phiên và thiết bị của nó.
  **Không sửa lịch sử bất biến** (đơn, quyền học, hoàn tiền, đồng ý, sự kiện học vẫn gắn tài khoản gốc); quyền học và lịch sử được đọc theo
  **nhóm gộp** (tài khoản đích + các tài khoản đã gộp vào nó) — cập nhật 30/10 sau review thiết kế. Ghi nhật ký đầy đủ. Không tự gộp.

## 5. Tài khoản quản trị (ISSUE-17, 18)

- **Khởi tạo:** tài khoản chủ đầu tiên tạo bằng lệnh trên máy chủ (không có giao diện tạo chủ). Khôi phục khẩn cấp cũng bằng lệnh máy chủ.
- **Mời (ISSUE-38):** danh sách cho phép chính là bảng lời mời/tài khoản quản trị với trạng thái `đang mời → đang hoạt động`, `hết hạn`, `đã thu hồi`.
  Chủ thêm email (chuẩn hóa chữ thường) → `đang mời`, hết hạn sau 7 ngày; đăng nhập lần đầu bằng Google (email đã xác minh) hoặc link email trong
  hạn → `đang hoạt động`. Lời mời `hết hạn` hoặc `đã thu hồi` **không còn quyền đăng nhập**; muốn vào lại thì chủ mời lại. Chỉ trạng thái
  `đang hoạt động` (hoặc `đang mời` còn hạn, cho lần kích hoạt) mới được xác thực.
- **Cách ly:** cookie, bảng phiên, đường dẫn callback và cấu hình đăng nhập của quản trị (phiên tự quản lý, quyết định D1 đã duyệt 30/10) tách khỏi học viên; test chứng minh phiên học viên gọi
  API quản trị bị từ chối và ngược lại.
- **Thu hồi:** bỏ khỏi danh sách hoặc đổi vai trò → hủy mọi phiên quản trị của người đó ngay. Phiên quản trị tối đa 12 giờ, không hoạt động
  1 giờ thì hết (đề xuất).
- **Bảo vệ chủ:** ràng buộc ở máy chủ và DB (không chỉ giao diện): luôn còn ít nhất một chủ đang hoạt động; không tự hạ quyền chủ cuối cùng.
- **Ma trận quyền (đề xuất, chờ G11):**

| Thao tác | Chủ | Hỗ trợ |
| --- | --- | --- |
| Xem đơn, hàng chờ, học viên (số điện thoại che bớt) | Có | Có |
| Ghép tiền vào đơn | Có | Có |
| Cấp không thu tiền | Có | Không |
| Hoàn tiền, gộp tài khoản | Có | Không (đề xuất; hoặc hỗ trợ đề nghị, chủ duyệt) |
| Đổi giá, mã giảm giá, quản lý quản trị, xuất dữ liệu | Có | Không |
| Xem dữ liệu ngân hàng gốc, số điện thoại đầy đủ | Có | Chỉ khi xử lý đơn đó |

Thao tác nhạy cảm (hoàn tiền, gộp, xuất dữ liệu, quản lý quản trị) yêu cầu xác thực lại trong 10 phút. Nhật ký ghi cả lần bị từ chối.

## 6. Thiết bị, offline, đồng bộ (ISSUE-19, 20, 21)

- **Thiết bị (đề xuất G10):** một “thiết bị” là một bản cài/trình duyệt có mã thiết bị ngẫu nhiên lưu trên máy, đăng ký khi đăng nhập; tối đa
  2 thiết bị hoạt động. Đăng nhập máy thứ ba → chọn máy cũ để thay (máy đó bị thu hồi ở lần kết nối tới). Xóa dữ liệu/cài lại = thiết bị mới.
  Thiết bị không kết nối quá thời hạn offline thì tự hết hạn và nhả chỗ. Học viên tự xem và gỡ thiết bị trong “Tài khoản của tôi”; hỗ trợ có
  thể gỡ hộ (có nhật ký).
- **Giấy phép học offline (đề xuất G9):** mỗi lần đồng bộ, máy chủ cấp cho thiết bị một giấy phép có chữ ký, hiệu lực 30 ngày, cho các khóa
  đang có quyền. Hết hạn mà chưa kết nối: vẫn mở được app, nhưng khóa bài mới cho tới khi kết nối (ân hạn đề xuất 7 ngày để học tiếp bài
  đã tải). Hoàn tiền/thu hồi thiết bị có hiệu lực ở lần kết nối tới; **ghi rõ trong chính sách** rằng nội dung đã tải không bị thu hồi tức thì
  khi máy chưa có mạng. Đồng hồ máy bị chỉnh lùi: dùng thời điểm lớn nhất từng thấy làm mốc.
- **Đồng bộ:** mỗi sự kiện học có mã duy nhất (UUID tạo trên máy) và thứ tự trên máy; máy chủ chấp nhận idempotent theo mã; tiến độ
  chỉ tăng (lấy giá trị cao nhất), điểm bài kiểm tra lưu từng lần làm; kiểm tra quyền học tại thời điểm nhận (sự kiện của khóa đã hết quyền
  vẫn lưu làm lịch sử nhưng không mở thêm gì); máy chỉ xóa hàng chờ sau khi máy chủ xác nhận.
- **Gói bài offline:** mỗi khóa có manifest có phiên bản (danh sách tệp, kích thước, hash); tải theo từng tệp, kiểm hash, chỉ đánh dấu
  “đã tải xong” khi đủ; báo dung lượng trước khi tải; phát hiện bị trình duyệt xóa dữ liệu và hướng dẫn tải lại.

## 7. Tệp media và quyền truy cập (ISSUE-22)

- **Công khai:** ảnh trang bán hàng, nội dung 3 bài học thử.
- **Được bảo vệ:** bài và audio của khóa trả phí. Chỉ tải qua API kiểm tra quyền học (đường dẫn có chữ ký, sống ngắn, hoặc phục vụ qua app);
  không có đường dẫn cố định công khai tới tệp trả phí. Nếu sau bật CDN thì chỉ cache phần công khai.
- Tệp đã tải về máy để học offline thì không thu hồi được tức thì (mục 6).

## 8. Vận hành một VPS (ISSUE-23, 24, 25)

- **Cấu hình và giám sát (G8):** ước lượng CPU/RAM/ổ đĩa/băng thông từ số học viên dự kiến và dung lượng audio; giới hạn tài nguyên từng
  container; cảnh báo ổ đĩa (70%/85%), RAM, app ngừng, chứng chỉ sắp hết hạn; tường lửa chỉ mở 80/443 và SSH bằng khóa; cập nhật bảo mật
  định kỳ; deploy có thể quay lại bản trước; ai nhận cảnh báo khi chủ dự án ở biển.
- **Sao lưu và khôi phục (bắt buộc trước ra mắt):** sao lưu tự động, **mã hóa**, gửi **ra ngoài VPS**; PostgreSQL bằng `pg_dump` hoặc sao lưu
  có WAL cho điểm khôi phục; thư mục media, cấu hình, bí mật (lưu riêng, an toàn); lịch và thời gian giữ (đề xuất: DB hằng ngày giữ 30 ngày,
  media hằng ngày theo kiểu tăng dần); cảnh báo khi sao lưu lỗi; RPO/RTO chốt ở G8 (đề xuất RPO 24 giờ, RTO 1 ngày); **thử khôi phục trên máy
  khác** trước ra mắt và mỗi quý; người phụ trách: người vận hành trên bờ, chủ dự án biết quy trình.
- **Job định kỳ (chốt đề xuất):** một **container worker** trong cùng docker compose chạy bộ lập lịch và job, **không** mở endpoint job ra internet.
  Mỗi lần chạy có mã, ghi trạng thái (bắt đầu, xong, lỗi, thời lượng) vào DB; khóa có thời hạn và gia hạn khi đang chạy; timeout và thử lại
  theo từng job; khi deploy, worker cũ dừng nhận job mới trước khi worker mới chạy; nút chạy lại tay trên trang quản trị; cảnh báo khi job
  lỡ lịch, lỗi, hoặc kẹt. Múi giờ ghi rõ cạnh mỗi lịch.

## 9. Dữ liệu cá nhân (ISSUE-28)

Trước khi chốt thiết kế dữ liệu (G12a) phải có (văn bản pháp lý cuối thuộc G12b): bảng dữ liệu thu thập → mục đích → bên xử lý (Zalo, SePay, nhà cung cấp email, Azure Speech, Claude) → thời hạn
lưu → cách xóa/ẩn danh; bằng chứng đồng ý (`consents`); ngoại lệ dữ liệu còn trong bản sao lưu cho tới khi hết hạn giữ; thông tin hộ kinh doanh
và liên hệ trên trang. Mỗi mục ánh xạ sang tiêu chí kiểm thử (ví dụ job xóa ghi âm quá hạn).

## 10. Phạm vi giai đoạn 1 (chốt 30/10/2026, G3 đóng)

Có: tài khoản học viên (email + Google; đăng nhập bằng số điện thoại qua Zalo chỉ khi **G6, G15 và phần liên quan của G12a** đều xong), tài khoản quản trị, danh mục và trang khóa, đơn + thanh toán QR + SePay + hàng chờ
xử lý tay + hoàn tiền tay, quyền học, app học PWA với bài có sẵn (Engine Cadet, audio khi có), tải offline + đồng bộ, thông báo email +
Telegram, job định kỳ, sao lưu.
Để sau: trợ lý AI 3D và hội thoại, chấm phát âm Azure, hồ sơ nghề nghiệp, chương trình quyền lợi hồ sơ, xuất CSV nâng cao, quản lý nội dung
(L1) bản đầy đủ, combo/mã giảm giá nếu G14 chưa xong.

## 11. Sẵn sàng nhà cung cấp và phương án dự phòng (ISSUE-27)

| Nhà cung cấp | Bằng chứng cần có | Nếu chậm hoặc bị từ chối |
| --- | --- | --- |
| SePay | Webhook thật với số tiền nhỏ, ảnh cấu hình HMAC, API đối soát gọi được | Mở bán với xác nhận tay toàn bộ (hàng chờ) cho tới khi xong |
| Zalo ZNS | OA xác thực, mẫu tin duyệt, tin thử tới máy thật | Đăng nhập email/Google; **không** chuyển sang SMS trừ khi chủ dự án đổi quyết định |
| Email | Tên miền gửi xác minh (SPF/DKIM), email thử không vào thư rác | Google cho học viên; quản trị dùng Google |
| VPS | Máy chạy, sao lưu và khôi phục thử thành công | Không ra mắt |
