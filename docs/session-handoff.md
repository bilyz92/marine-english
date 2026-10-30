# Bàn giao phiên

Trạng thái hiện tại. Mỗi phiên cập nhật đè lên tệp này. Quyết định lâu dài giữ ở CLAUDE.md, luồng ở `docs/data-flows.md`.

## Phiên 26–29/10/2026

### Mục tiêu
Tìm lại giao diện đã làm, tiếp tục thiết kế trên đó, thêm các màn mới và kiểm tra chất lượng.

### Hiện trạng đã xác minh
- `D:\project-marine-english` không phải repo git. Trước phiên này chỉ có `CLAUDE.md` và 2 tệp `.docx`.
  Không có mã nguồn, không có lệnh build hay test.
- Giao diện là bảng Claude Design **“Marine English – Dashboard quản trị”**:
  https://claude.ai/artifact/GGG6B1yonpRgD2FQ5hizCy
  - Trang **Bán hàng**: `Home`, `Course`, `Checkout`, `MobileCheckout`, `About`.
  - Trang **Quản trị**: `Main`, `Mobile`, `Content`, `ContentMobile`.
  - **Page 3**: `Artboard-zd48`, đang trống.
- Bản cũ hơn “Marine English Teacher” (màn bài học có trợ lý ảo): https://claude.ai/artifact/MjrcZVh6ogJYWDPUSR7hHD

### Đã hoàn thành
0. **Bổ sung trợ lý AI 3D vào quy trình (28/10/2026, yêu cầu mới nhất, L5):** cập nhật trực tiếp bản `Quy_trinh_xay_dung_app_tieng_Anh_cho_thuyen_vien_may_bo_sung_ho_so_hoc_vien.docx`, thêm mục 7A với 11 luồng A1–A11 và nối vào các mục liên quan. Gồm dựng hình từ ảnh, tư vấn web, dạy theo giáo án, ba giọng Philippines/Ấn Độ/Mỹ, quyền truy cập cấu hình được, hạn mức, ngoại tuyến, dữ liệu và nghiệm thu. Hai bản Word cũ giữ nguyên. Chưa dựng code hoặc sửa bảng thiết kế. Đối chiếu nội dung và bảo toàn bảng/ảnh đạt; chưa kiểm tra bố cục trang vì máy không có LibreOffice/Word để render. Bản sao trước sửa và báo cáo nằm ở `docs/.qa-ai3d/`.
1. **Thêm nội dung** (luồng L1): thêm khung `Content.dc.html` và `ContentMobile.dc.html`, thêm mục “Nội dung” vào menu `Main.dc.html`,
   cập nhật `canvas.json` (2 khung mới ở trang Quản trị).
2. **Kiểm tra và sửa lỗi L1:** sửa 7 lỗi.
   - Hẹn giờ “đọc đường dẫn” cũ hiện lỗi sai lúc.
   - Bấm Lưu nhiều lần tạo mục trùng.
   - Thông báo cũ tắt sớm thông báo mới.
   - Liên kết giữa đoạn văn không bấm được.
   - Danh sách đánh số bị đổi thành gạch đầu dòng.
   - Khung điện thoại cố định 1600px cắt mất nút; đã đổi sang chiều cao tối thiểu.
   - Không tìm thấy lỗ hổng XSS: nội dung hiển thị dạng chữ, `href` chỉ là http(s).
3. **Về tôi** (luồng L2): thay nội dung mẫu trong `About.dc.html` bằng bài “Câu chuyện người sáng lập” nguyên văn;
   đổi chiều cao khung trong `canvas.json` từ 2900 lên 3000.
4. Thêm `docs/data-flows.md`, `docs/session-handoff.md` (tệp này) và một dòng hướng dẫn trong `CLAUDE.md`.
5. **Bổ sung quy trình cơ sở dữ liệu (28/10/2026):** cập nhật tệp Word `(bổ sung luồng dữ liệu).docx`, thêm mục **5A Thiết kế tạo lập và khai thác cơ sở dữ liệu** trước mục 6. Gồm 8 bước, ba luồng nội dung học / mua và học / học khi mất mạng, cùng danh sách đầu ra cần bàn giao; nối công việc vào lộ trình hiện có. Đồng bộ các tham chiếu công nghệ với Neon, Auth.js và R2, bỏ ước tính giá cũ của Supabase. Bản Word `(1).docx` giữ nguyên. Đây là cập nhật kế hoạch, chưa tạo cơ sở dữ liệu hay mã nguồn.

6. **Giao diện website theo quy trình mới (28/10/2026, luồng L4 trong `docs/data-flows.md`):** đọc
   `Quy_trinh_xay_dung_app_tieng_Anh_cho_thuyen_vien_may_bo_sung_ho_so_hoc_vien.docx`, thêm 6 khung vào trang “Bán hàng” của bảng:
   `Catalog`, `Login`, `MyCourses`, `Account`, `Policies`, `Contact` (cùng `canvas.json`).
   - Không sửa `Home`, `About`, `Content`, vì chủ dự án đã chỉnh tay.
   - Kiểm tra cấu trúc và logic bằng Node đạt; chưa xem trong trình duyệt.
   - Phiên bản bảng sau khi thêm: `1793196490-b0e7`.

7. **29/10/2026, đã đăng:** khung “Thông tin người mua” (L6) và 2 khung app học Engine Cadet (L7, trang mới “App học”).
   - Gồm `BuyerInfo`, `CadetCourse`, `CadetLesson`; `Catalog`, `MyCourses` và `Course` có nút Mua trỏ sang `BuyerInfo`.
   - Bảng **đang chia sẻ công khai** (read = public). Chủ dự án đã cho phép đăng lên bản công khai (29/10).
     Mỗi lần đăng sau vẫn cần `shared_live: public`, và mọi thay đổi hiện ngay với người có link.
   - Phiên bản bảng sau khi đăng: `1793281656-0535`.
   - Bản sao các tệp đã đăng: `docs/design/canvas-pending/project/`. Đây chỉ là bản sao tham khảo, không phải nguồn chính:
     luôn đọc lại từ bảng trước khi sửa.

8. **29/10/2026, CHỐT GIAO DIỆN v1:** chủ dự án chốt giao diện ở phiên bản bảng `1793281656-0535` (18 khung).
   - Spec giao diện và Plan triển khai: tab **“Spec giao diện v1 (chốt 29/10)”** trong tài liệu hệ thống
     https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD, cạnh 2 tab cũ.
   - Spec gồm: mã màn WEB-01…12, APP-01…02, ADM-01…04 gắn UC/FR; quy ước giao diện; spec từng màn; sơ đồ điều hướng;
     9 điểm lệch cần chốt; plan 8 giai đoạn.
   - **Từ nay:** sửa giao diện phải ghi vào tab Spec trước.
   - **Việc tiếp theo:** chủ dự án quyết 9 điểm ở mục 8 của Spec (giai đoạn 0), rồi duyệt bắt đầu giai đoạn 1 (dựng code).

9. **29/10/2026, tải giao diện về dự án:** `docs/design/giao-dien-v1/` chứa đủ 19 màn `.dc.html` + `canvas.json`,
   khớp 20/20 tệp với bảng theo sha256.
   - Kèm `support.js` (bộ chạy xem trước tự viết), `serve.js`, `Mo-giao-dien.cmd`, `index.html`, `README.md`.
   - Kiểm thử bằng jsdom qua `serve.js`: 18/18 màn dựng xong, không còn `{{ }}`, không lỗi JS;
     15 tình huống bấm thử đạt (bảng Main, mua, bài học 3 mức, lọc khóa, mã giảm giá, mục lục).
   - Chưa mở bằng trình duyệt thật.
   - `docs/design/canvas-pending/` là bản sao cũ, một phần; nay dùng `docs/design/giao-dien-v1/`.

10. **29/10/2026, tài liệu hiện trạng hệ thống:** tạo tài liệu Claude Docs
    https://claude.ai/artifact/Kwkz2xzS97vjspQFHj7r3r (17 mục, 4 sơ đồ: kiến trúc, trạng thái đơn, lộ trình 14 tuần).
    - Nguồn: bản Word mới nhất, tệp này, `docs/data-flows.md`, `docs/design/giao-dien-v1/`, học liệu Engine Cadet v6.
    - **Chưa đối chiếu** với tài liệu đặc tả https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD, vì tài khoản đăng nhập
      lúc đó không có quyền đọc. Chủ dự án: bổ sung sau.
11. **29/10/2026, QUYẾT ĐỊNH thanh toán giai đoạn đầu:** trang thanh toán dùng ảnh QR có sẵn của tài khoản ngân hàng,
    hiện số tiền và mã đơn làm nội dung chuyển khoản. **SePay** theo dõi tài khoản, gửi webhook có chữ ký; hệ thống
    tự xác nhận khi mã đơn trong nội dung và số tiền khớp. Sai nội dung/số tiền/sau hạn → "cần xử lý tay", admin ghép
    và cấp quyền tay (ghi `admin_audit_log`). Chưa dùng payOS. Đã ghi vào CLAUDE.md và mục 7 của tài liệu hiện trạng.
    - Đã chốt: giữ thời hạn đơn 15 phút, **tính theo thời điểm giao dịch ngân hàng** trong webhook, không theo lúc webhook đến
      (SePay gửi lại webhook lỗi tối đa 7 lần trong ~33 phút). Đơn đã bị job chuyển “hết hạn” mà webhook đến sau có thời điểm
      giao dịch trong hạn, đúng tiền, đúng mã → chuyển thẳng sang “đã thanh toán”; tiền có thời điểm giao dịch sau hạn mới
      vào “cần xử lý tay”. Sơ đồ trạng thái đơn trong tài liệu hiện trạng (mục 7) chưa có mũi tên này; cấp tay bắt buộc nhập mã giao dịch ngân hàng, từ chối mã đã dùng.
    - Webhook SePay phải dùng kiểu xác thực HMAC-SHA256 (`X-SePay-Signature`) và kiểm tra `X-SePay-Timestamp`,
      không dùng API Key hay không xác thực (theo developer.sepay.vn, mục xác thực và bảo mật webhook).
    - Mã đơn: chuỗi ngẫu nhiên, không bao giờ trùng (chủ dự án chốt). Chi tiết đề xuất, chờ xác nhận: `ME` + 8 ký tự
      in hoa/số, bỏ ký tự dễ nhầm, ví dụ `ME7K3QX9`; ràng buộc duy nhất trong DB, trùng thì sinh lại.
    - Còn chờ chốt: gói/phí SePay, tài khoản ngân hàng liên kết, ai xử lý đơn sai nội dung và trong bao lâu.
    - Chữ trên `Checkout`, `MobileCheckout`, `BuyerInfo` về 15 phút, khóa tự mở, đối chiếu trong 24 giờ khi đã chuyển thì khớp cách này.
      **Sửa lại 30/10 sau khi xem ảnh:** các màn này vẫn còn chữ lệch (payOS, “số tiền và nội dung đã điền sẵn”, nút “Tạo mã VietQR”,
      mở app ngân hàng tự điền), nên **vẫn phải sửa bảng**; chi tiết ở `docs/ui-review-2026-10-30.md` mục 1.

12. **29/10/2026, học từ dự án Waker:** chủ dự án yêu cầu đọc `/home/bilyz/project/waker` (chỉ đọc). Kết quả ở
    `docs/lessons-from-waker.md`: mã đơn ngẫu nhiên + index duy nhất, tách command ghi, phân quyền theo dòng, lịch chạy
    quản lý được, nhật ký thao tác quản trị có trước/sau; tránh tin giá trình duyệt, tài liệu lệch code, thiếu test, tắt CSRF,
    mã đơn chỉ duy nhất trong đơn chưa xóa, khóa job không nguyên tử, cron không rõ múi giờ, không giới hạn đăng nhập sai.

13. **30/10/2026, học từ LMS Cole:** chủ dự án yêu cầu đọc `/home/bilyz/project/lms_cole` (chỉ đọc). Kết quả ở
    `docs/lessons-from-lms-cole.md`: mẫu gửi mã qua Zalo ZNS đã chạy thật, vòng đời OTP, khóa dòng khi xử lý thanh toán; tránh
    dò mã không giới hạn, `Random` thường, xác minh dùng lại được, lưu mã dạng rõ, giao dịch không gắn đơn.
    Câu hỏi cho chủ dự án: có dùng chung Zalo OA / đối tác ZNS của Cole được không.

### Ngoài phạm vi nhưng có xảy ra
Hồ sơ nghề nghiệp giai đoạn 1 được làm trong **Marine Academy** với sự cho phép riêng lần đó (xem L3 trong `docs/data-flows.md`).
Sau đó chủ dự án yêu cầu **chỉ làm cho dự án này**. Phần đó vẫn nằm ở Marine Academy, chưa commit; dự án này không chứa nó.

### Quyết định và lý do
- **Giao diện làm trên bảng thiết kế, không dựng code.** Chủ dự án hai lần chọn “Chỉ thêm vào bảng thiết kế”
  khi dự án chưa có code. Phải báo trước khi tạo code mới.
- **L1 không giả lập thành công.** Đọc đường dẫn và nhúng luôn báo không được, vì bảng không thể làm thật.
  Không hiện nội dung giả.
- **Khung `About.dc.html`:** bỏ toàn bộ nội dung mẫu trùng với bài viết, không thêm ảnh, chứng chỉ hay thành tích.

### Kiểm tra đã chạy thật
- Logic L1 bằng Node (DCLogic giả lập): mỗi khung **47/47 đạt** sau khi sửa. Trước khi sửa là 41/47.
- Cân bằng thẻ HTML và cú pháp `{{ }}`: đạt với `Content`, `ContentMobile`, `Main`, `About`. `canvas.json` là JSON hợp lệ.
- L2: so chữ hiển thị với nguyên văn, 17/17 đoạn khớp.
- Bộ kiểm thử nằm trong thư mục scratchpad tạm của phiên (`…\scratchpad\review\test.mjs`, `tags.mjs`).
  **Không có trong repo**, có thể đã mất.
- **Chưa** mở bảng thiết kế bằng trình duyệt tự động. Không có Playwright hay công cụ trình duyệt.

### Lỗi, giới hạn, dang dở
- Mọi màn trên bảng chỉ là thiết kế. Không có lưu trữ, tải lại là mất.
- L1 chưa có focus/Esc cho hộp thoại. Dashboard điện thoại chưa có lối vào màn Nội dung điện thoại.
- Bảng chưa có khung “Về tôi” cho điện thoại, chưa có màn “Hồ sơ nghề nghiệp”.
- Chân trang `About` còn chỗ trống pháp lý (tên hộ kinh doanh, địa chỉ, mã số thuế). Link Zalo/Messenger vẫn là `#`.
- Ngày 28/10 có người (nhiều khả năng là chủ dự án) đã sửa bảng trực tiếp:
  - thêm `left: 1px` vào lớp phủ hộp thoại của `Content.dc.html`, em đã giữ lại;
  - sau đó có thêm một phiên bản mới hơn lần publish cuối (`1793120094-ded9`), chưa được đọc. Ghi chú 29/10: các lần đăng sau
    đã lên phiên bản `1793281656-0535` (bản chốt v1), nên mục này không còn là việc treo.
- CLAUDE.md mô tả kiến trúc dự kiến (lúc đó Next.js + Neon + Auth.js; từ 30/10 là một VPS). Code thật ở Marine Academy là Express + SQLite + OTP.
  Hai hướng này chưa được chủ dự án thống nhất. **Cập nhật 30/10/2026:** chủ dự án chốt Next.js (xem Bước tiếp theo, mục 4).

### Bước tiếp theo (cập nhật 29/10/2026)
0. **30/10/2026: review đối kháng với Codex** (`/codex-plan-review`) trên bộ quyết định. Kết quả và sổ quyết định đầy đủ (cổng G1–G15,
   cái nào chặn thiết kế / giai đoạn 1 / ra mắt) ở **`docs/design-gates-2026-10-30.md`** — dùng tệp đó làm danh sách việc chính;
   các mục dưới đây giữ làm ngữ cảnh. Codex APPROVE ở vòng 4 (44 điểm, đều đã sửa).
   **Bản nháp thiết kế kỹ thuật:** `docs/technical-design-draft-2026-10-30.md` (chưa đối chiếu tài liệu đặc tả, đánh dấu `[Gx]`).
   Bước sau: chủ dự án đóng G3 (phạm vi giai đoạn 1) → viết plan giai đoạn 1; đóng G1 → đối chiếu và chốt thiết kế.
   **30/10: G3 đã đóng (phạm vi theo DG §10), D1 đã duyệt (tự quản lý phiên, không Auth.js).** Việc tiếp: Codex duyệt bản nháp thiết kế →
   viết plan giai đoạn 1. Bắt đầu code còn cần G2 (cập nhật tab Spec + giao diện; cần quyền vào tài liệu đặc tả).
1. **Giai đoạn 0 của Spec giao diện v1:** chủ dự án quyết 9 điểm lệch ở mục 8 tab Spec, rồi duyệt bắt đầu giai đoạn 1 (dựng code).
   Giao diện v1 đã chốt ở phiên bản bảng `1793281656-0535`; sửa giao diện phải ghi tab Spec trước.
2. **Thanh toán còn chờ chốt** (mục 11 ở trên): gói/phí SePay, tài khoản ngân hàng liên kết, xác nhận chi tiết mã đơn
   (`ME` + 8 ký tự), ai xử lý đơn sai nội dung và trong bao lâu.
3. **Đăng nhập (chốt 30/10/2026):** email + Google, và số điện thoại nhận mã qua Zalo (ZNS). Không dùng SMS vì trên tàu
   thường chỉ có Starlink, không có sóng di động. Nhờ vậy mục 8A và màn `Login` (đăng ký bằng một liên hệ) giữ nguyên.
   Còn cần: Zalo OA đã xác thực, mẫu tin ZNS được duyệt, chi phí mỗi tin, giới hạn số lần gửi mã theo số điện thoại và IP.
   Màn `Login` ghi “Mã gửi tới {liên hệ}”; có thể ghi rõ “qua Zalo” khi người dùng nhập số điện thoại (đề xuất, chưa sửa bảng).
   - **Liên kết tài khoản (chốt 30/10/2026):** một tài khoản gắn nhiều cách đăng nhập (số điện thoại qua Zalo, email, Google).
     Học viên tự liên kết thêm trong “Tài khoản của tôi” khi đang đăng nhập, sau khi xác minh cách mới. Không tự gộp theo tên.
     Đã lỡ có hai tài khoản → admin gộp tay (chuyển `enrollments`, tiến độ), ghi `admin_audit_log`. Lý do: tránh khách đăng ký
     bằng số điện thoại rồi đăng nhập Google, sinh tài khoản trống và tưởng mất khóa đã mua.
   - Mã qua Zalo chỉ tới số có dùng Zalo; người không dùng Zalo đăng nhập bằng email/Google, màn `Login` cần ghi rõ.
     Số điện thoại lưu một dạng chuẩn (+84…).
   - Bảng thiết kế chưa có: mục liên kết cách đăng nhập trong `Account`, dòng ghi chú Zalo trên `Login`, màn gộp tài khoản
     cho admin. Sửa thì ghi tab Spec trước.
   - **Tách hai loại tài khoản (chốt 30/10/2026):** học viên ở `users`, quản trị ở `admin_users`; không chung bảng, phiên hay
     cách đăng nhập. Quản trị: không tự đăng ký, anh thêm email vào danh sách cho phép; đăng nhập bằng Google hoặc link qua email
     (nên bật xác minh 2 bước Google); vai trò chủ / hỗ trợ; tài khoản chủ không xóa hay hạ quyền được qua giao diện; phiên riêng
     tại `/quan-tri`. `admin_audit_log` ghi `admin_users.id`. Quản trị muốn học thì tạo tài khoản học viên riêng, cấp khóa tay có
     ghi nhật ký. Mã qua Zalo, liên kết tài khoản, giới hạn 2 thiết bị chỉ áp dụng cho học viên.
   - Bảng thiết kế chưa có màn đăng nhập quản trị và màn quản lý danh sách quản trị (thêm email, vai trò).
   - **Nội dung sửa tab Spec đã soạn sẵn:** `docs/spec-v1-changes-2026-10-30.md` (chưa dán vì không có quyền vào tài liệu đặc tả).
   - **Kiểm tra giao diện 30/10/2026** (chụp bằng Chrome headless qua `serve.js`, 18/18 màn hiển thị, lần đầu xem bằng trình duyệt thật;
     ảnh ở `docs/design/anh-chup-v1-2026-10-30/`, gồm 16 trạng thái phải bấm; **bản tổng hợp đầy đủ: `docs/ui-review-2026-10-30.md`**,
     công cụ chụp lại: `docs/design/tools/`). Ghi chú gốc bên dưới giữ lại.
     Chữ lệch quyết định, chưa sửa (phải ghi tab Spec trước):
     `Checkout` (“Thanh toán an toàn qua payOS”, “[VietQR do payOS tạo]”, “Số tiền và nội dung đã điền sẵn”);
     `MobileCheckout` (“Cách 1: Mở thẳng app ngân hàng, số tiền và nội dung tự điền sẵn” — ảnh QR có sẵn không làm được);
     `Home` (“Số tiền và nội dung đã điền sẵn, không phải gõ”; bước 1 chỉ nhắc email/Google, thiếu Zalo);
     `Main`, `Mobile` (“Webhook payOS” → SePay; mã đơn mẫu `ME-1051` tăng dần, có gạch → mã ngẫu nhiên; nút “Cấp khóa” chưa có ô
     nhập mã giao dịch; dòng “Vai trò quản trị · 2 thiết bị” — giới hạn 2 thiết bị chỉ cho học viên);
     `Login` (chưa ghi mã gửi qua Zalo, chưa hướng dẫn người không dùng Zalo); `Account` (chưa có liên kết cách đăng nhập).
     Lỗi bố cục: nút “Áp dụng” mã giảm giá ở `Checkout` bị xuống 2 dòng; bảng “Đơn gần đây” ở `Main` cột mã đơn và tên bị
     xuống dòng (“ME-” / “1054”). Năm khung trên bảng ngắn hơn nội dung (`Home`, `Main`, `Mobile`, `CadetCourse`,
     `MobileCheckout`); ba khung điện thoại không có `expand: fill` nên có thể bị cắt phần cuối trên bảng, cần tăng chiều cao
     trong `canvas.json` của bảng. Menu bên trái của trang quản trị không thống nhất: `Main` có 11 mục (thêm Cần xử lý tay,
     Hoàn tiền, Mã giảm giá, Nhật ký thao tác), `Content` chỉ có 7 mục.
     **Lỗi lớn ở `Home` (phần đầu trang):** thẻ `<section>` của hero có style `width: 1428px; height: 549px; display: grid;
     grid-template-columns: repeat(2, …)` (nhiều khả năng do sửa tay trên bảng). Vì chỉ có một khối con, toàn bộ nội dung bị dồn vào
     nửa trái, khung ảnh “[Ảnh Marine English Teacher]” rơi xuống dưới, tràn khỏi chiều cao cố định 549px và đè lên tiêu đề
     “Chọn khóa học”; mép phải trang có dải trắng 12px. Đây là CSS thường, không phải do bộ chạy xem trước. Chưa sửa vì `Home`
     do chủ dự án sửa tay. Bảng trên claude.ai vẫn ở `1793281656-0535`, `canvas.json`
     khớp sha256 với bản trong máy; tài khoản đăng nhập ngày 30/10 chỉ đọc được bảng, không đăng được. Thiếu màn: đăng nhập quản trị, quản lý danh sách quản trị, gộp tài khoản.
4. **Hướng kỹ thuật (chốt 30/10/2026):** Next.js + PostgreSQL + Auth.js. Marine Academy (Express + SQLite) là dự án riêng,
   không làm nền cho dự án này.
   - **Hạ tầng (chốt 30/10/2026): một VPS**, không Vercel, không Neon, không Cloudflare lúc đầu. VPS chạy app Next.js (Docker),
     PostgreSQL và tệp audio/ảnh; HTTPS bằng Let's Encrypt; DNS ở nơi mua tên miền; cron trên VPS (đặt múi giờ rõ ràng).
     Lưu tệp qua một module để sau chuyển sang R2/S3, và có thể bật Cloudflare CDN phía trước mà không đổi đường dẫn.
     Lý do: PostgreSQL đặt trên VPS nên đằng nào cũng cần VPS; Cloudflare không có PostgreSQL; Workers miễn phí giới hạn CPU 10 ms
     mỗi lượt, khó đủ cho Next.js. Học offline không phụ thuộc nơi đặt máy chủ (bài và audio tải về điện thoại).
   - Còn chờ: chọn nhà cung cấp và cấu hình VPS (CPU, RAM, ổ đĩa, băng thông), lịch sao lưu DB + thư mục tệp và thử khôi phục,
     người theo dõi máy chủ.
5. **Đối chiếu tài liệu đặc tả** https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD (chủ dự án: bổ sung sau). Tài khoản đăng nhập
   cuối phiên không đọc được cả tài liệu đặc tả lẫn tài liệu hiện trạng; cần chia sẻ lại hoặc đăng nhập tài khoản cũ.
   Khi sửa được, cập nhật tài liệu hiện trạng: mục 3 và sơ đồ kiến trúc (một VPS chạy app + PostgreSQL + tệp; bỏ Vercel, Neon, R2),
   mục 6 (media lưu trên VPS), bảng job mục 10 (bỏ payOS, cron trên VPS, ghi múi giờ), mục 14 (chi phí: bỏ Vercel/Neon, thêm VPS), mục 6 (mã đơn duy nhất cả đơn đã xóa),
   mục 7 (HMAC SePay, hạn đơn theo thời điểm giao dịch, thêm mũi tên “Hết hạn → Đã thanh toán” vào sơ đồ trạng thái),
   mục 3 (Auth.js: email, Google, mã qua Zalo ZNS; không SMS; đã chốt Next.js), mục 17 (bỏ rủi ro “hai hướng kỹ thuật”),
   mục 2 (thêm `docs/lessons-from-waker.md`), mục 4 và mục 6 (tách `users` học viên với `admin_users` quản trị,
   liên kết nhiều cách đăng nhập cho học viên), mục 7 (bỏ câu “chữ trên các màn đã khớp, không cần sửa” — sai, xem
   `docs/ui-review-2026-10-30.md`), mục 5 (thêm link bản rà soát giao diện và thư mục ảnh).
6. Chủ dự án cần điền các chỗ [chờ …]: quyền lợi, thời hạn lưu, văn bản chính sách, liên hệ Zalo/Messenger/email, thông tin hộ kinh doanh.
7. Việc thiết kế còn thiếu (đề xuất, chưa được yêu cầu): nối `Home` tới `Login`, `Catalog`, `Policies`, `Contact`; màn Hồ sơ nghề nghiệp;
   “Về tôi” bản điện thoại; lối vào Nội dung trên Dashboard điện thoại; dọn Page 3. Đọc lại bảng trước khi sửa.
8. Nếu chủ dự án muốn tính năng chạy thật thì phải hỏi trước khi tạo code.

### Ràng buộc của chủ dự án cần giữ
- **Chỉ làm cho Project Marine English** (thư mục này và bảng thiết kế). Không truy cập Marine Academy nếu chưa được cho phép lại.
- Chưa có code thì **báo trước khi tạo mới**.
- Không commit, push, deploy nếu không được yêu cầu.
- Viết tiếng Việt, xưng “anh” với chủ dự án.
- Giữ nguyên văn nội dung chủ dự án cung cấp. Không bịa ảnh, chứng chỉ, thành tích, số liệu.
- Không đưa Supabase trở lại.
- Chủ dự án có thể sửa trực tiếp trên bảng: luôn đọc bản mới nhất và ghép thay đổi, không ghi đè.

### 30/10/2026 — đang chạy tự động giai đoạn 1
Chủ dự án yêu cầu “làm hết all plan” (P1→P5). Theo dõi tiến độ ở `PROGRESS.md` (gốc dự án). Thiết kế kỹ thuật đã được Codex
APPROVE; plan P1 được APPROVE. Không push/deploy; dịch vụ thật của G4/G6/G7/G8 để tắt/giả lập.

**P1 đã cài đặt xong (30/10/2026)** trên nhánh git cục bộ `phase1` (12 task, 224 test xanh, lint/typecheck/build sạch); lệnh chạy ở
`CLAUDE.md`. Có: Docker Postgres dev, Prisma + 2 migration (bảng đăng nhập; hàm SQL quản trị + chặn mất chủ cuối), phiên tự quản lý
(xoay token, phong bì 2 phút, CSRF), phân loại đường dẫn trong `src/proxy.ts`, OTP email (hộp thư giả `/dev/thu`), đăng nhập/đăng ký
email, giới hạn 2 thiết bị + vé thay máy, Google OIDC (học viên + quản trị), liên kết/gỡ định danh, mời/đổi/thu hồi quản trị viên, link
email quản trị, nhật ký quản trị, ma trận quyền (đề xuất G11), CLI `admin:bootstrap`/`admin:recover`. Zalo chỉ có adapter tắt (G6).
Đổi thư viện OIDC sang `oauth4webapi` (lý do trong sổ `.superpowers/sdd/…/progress.md`). Mọi quyết định khi chạy tự động ghi ở dòng
`Ruling:` của sổ đó. Review toàn nhánh P1 xong (Codex hết credit → reviewer độc lập; 2 lỗi quan trọng đã sửa).

**P2 đã cài đặt xong (30/10/2026)**, plan `docs/superpowers/plans/2026-10-30-p2-courses-orders-ledger.md` (12 task; Codex hết credit nên
plan chỉ tự rà). Có: nhập nội dung Engine Cadet thành khóa có phiên bản (`pnpm cli content:import`, khóa ở trạng thái nháp, chưa giá),
danh mục công khai + 3 bài học thử, chủ đặt giá/mở bán, tạo đơn (giá từ máy chủ, mã `ME`+8 ký tự, hạn 15 phút), sổ giao dịch bất biến,
webhook SePay có chữ ký (hợp đồng giả định chờ G4), tự xác nhận đúng trường hợp hợp lệ, hàng chờ xử lý tay, nhập sao kê + chủ xác minh,
ghép tay (một/nhiều giao dịch, thiếu/thừa tiền → hoàn phần thừa), kết luận bỏ qua/trùng, cấp quyền không thu tiền, hoàn tiền tay
(đề nghị → duyệt → chuyển → xác nhận; hoàn toàn phần thu hồi quyền học), gộp tài khoản, quyền học theo nhóm gộp. Thông báo mới ghi vào
`outbox_events` (P4 gửi). Chờ chủ dự án: G4 (SePay thật), G5 (định dạng mã đơn), G13 (chính sách hoàn), G14 (giá, mã giảm giá — chưa làm).
Quyết định khi chạy: dòng `Ruling:` trong `.superpowers/sdd/2026-10-30-p2-courses-orders-ledger/progress.md`.

**Tab Spec đã cập nhật (30/10/2026):** tài khoản đăng nhập mới mở được tài liệu đặc tả; đã thêm mục “10. Thay đổi sau ngày chốt” vào tab
“Spec giao diện v1 (chốt 29/10)” (quyết định 29–30/10 theo mã màn, sửa 11 điểm ở màn hiện có, 8 màn mới, việc đã làm trong mã). Không sửa
các mục 1–9 anh viết. Còn lại của G1/G2: đối chiếu tab “Tài liệu BA” (FR/NFR, quy tắc nghiệp vụ) với các quyết định trong repo; sửa bảng
thiết kế theo mục 10 rồi tải lại.
