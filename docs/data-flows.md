# Luồng nghiệp vụ và luồng dữ liệu

Cập nhật 29/10/2026 (L6, L7, quyết định thanh toán). **30/10/2026:** mọi màn đã được xem bằng Chrome headless qua bản trong máy
(ảnh ở `docs/design/anh-chup-v1-2026-10-30/`, kết quả ở `docs/ui-review-2026-10-30.md`). Các dòng “chưa xem trong trình duyệt” bên dưới ghi
trạng thái lúc làm từng luồng; riêng bảng thiết kế trên claude.ai vẫn chưa được mở bằng trình duyệt tự động. Ghi các luồng đã làm hoặc đã thay đổi trong các phiên gần đây. Dự án này **chưa có mã nguồn,
backend hay cơ sở dữ liệu**. L1–L4 ghi nhận các thiết kế đã làm; L5 là bổ sung quy trình trong Word, chưa thêm vào bảng. Giao diện nằm trên bảng thiết kế Claude Design:
https://claude.ai/artifact/GGG6B1yonpRgD2FQ5hizCy (sau đây gọi là “bảng”). Các luồng trên bảng là **bản thiết kế
bấm thử được**: trạng thái chỉ sống trong bộ nhớ của từng khung, mất khi tải lại, không gửi dữ liệu đi đâu.

Luồng thanh toán, đơn hàng, quyền học trong CLAUDE.md (mục “Payment flow invariants”) là thiết kế dự kiến, **không thay
đổi** trong các phiên này.

---

## L1. Thêm nội dung (bài viết / luồng thảo luận / liên kết)

- **Mục đích:** admin đưa nội dung vào app và chọn hiển thị thành trang riêng hoặc tab mới.
- **Người dùng:** quản trị (giả định; chưa có phân quyền thật). Từ 30/10/2026, tài khoản quản trị là loại riêng (`admin_users`),
  tách khỏi tài khoản học viên; xem CLAUDE.md.
- **Bản chất:** thiết kế bấm thử trên bảng. Chưa có backend, API, lưu trữ.
- **Tệp trên bảng:** `project/Content.dc.html` (máy tính, khung “Nội dung · máy tính”),
  `project/ContentMobile.dc.html` (điện thoại), mục menu “Nội dung” thêm vào `project/Main.dc.html`.
  Cả hai khung ở trang “Quản trị”, có `is_interactive`.
- **Điểm bắt đầu:** menu “Nội dung” trên Dashboard máy tính → màn Nội dung → nút “Thêm nội dung”.
  Tweak `startWith` = `form` (mặc định, mở sẵn biểu mẫu) hoặc `list`.
- **Các bước:**
  1. Chọn loại: Bài viết / Luồng thảo luận / Liên kết. Với Liên kết, nguồn luôn là đường dẫn.
  2. Chọn nguồn: Đường dẫn / Dán nội dung.
  3. Nhập tiêu đề, đường dẫn nguồn, nội dung.
     - Bài viết: dòng `#` là tiêu đề mục, `-`/`*` là gạch đầu dòng, `1.` là danh sách đánh số.
       Dòng chỉ chứa URL thành liên kết; URL nằm giữa đoạn hoặc dạng `[chữ](https://…)` cũng bấm được.
     - Luồng: mỗi mục cách nhau một dòng trống, viết `Tên: nội dung` để giữ người viết. Thứ tự giữ nguyên;
       không có tên thì không tự thêm tên.
  4. Chọn hiển thị: Trang riêng / Tab mới (cần tên tab ≤24 ký tự, không trùng).
  5. Liên kết: có thể đánh dấu “Nhúng trang gốc”.
  6. Bấm “Xem trước”. Máy tính hiện bên phải và báo khi biểu mẫu đã đổi sau lần xem trước;
     điện thoại mở màn xem trước riêng.
  7. Bấm “Lưu”: hiện “Đang lưu…”, khóa nút, rồi mở trang hoặc tab vừa tạo kèm thông báo đã lưu.
- **Đầu vào và kiểm tra (báo lỗi ngay dưới ô):** thiếu tiêu đề hoặc quá 120 ký tự; đường dẫn không phải http(s);
  thiếu nội dung (trừ Liên kết); thiếu, quá dài hoặc trùng tên tab.
- **Đầu ra:** mục mới trong danh sách với đường dẫn ổn định (`/quan-tri/noi-dung/<slug>` hoặc `/quan-tri/noi-dung?tab=<slug>`).
  Có Sửa (giữ nguyên slug) và Xóa (hỏi xác nhận).
- **Đọc từ đường dẫn:** bấm “Đọc nội dung” → “Đang đọc…” → **luôn báo không đọc được** (đăng nhập, quyền truy cập
  hoặc web chặn đọc tự động), kèm “Mở trang gốc” và “Chuyển sang dán nội dung”. Không bao giờ hiện nội dung giả.
- **Nhúng:** luôn hiện “Không nhúng được trang này vào app” và nút “Mở trang gốc”. Không có iframe.
- **An toàn:** nội dung hiển thị dạng chữ thường. Mọi `href` chỉ là http(s), có `rel="noopener noreferrer"`.
- **Nơi lưu:** không có. Hai mục mẫu gắn nhãn “Dữ liệu mẫu”. Tải lại là mất; hai khung không chia sẻ dữ liệu.
- **Đã kiểm chứng:** bộ kiểm thử Node chạy logic của từng khung, **47/47 đạt mỗi khung** sau khi sửa
  (lần đầu 41/47 trước khi sửa). Kiểm tra cân bằng thẻ HTML và cú pháp hole đều đạt.
- **Chưa kiểm chứng:** chưa xem bằng trình duyệt thật, gồm bố cục, chuyển màn và lỗi JS khi chạy trong bảng.
  Hộp thoại chưa tự chuyển con trỏ vào ô đầu và chưa đóng bằng Esc.
- **Chưa triển khai:** lưu thật, đọc trang qua máy chủ (cần chống SSRF), kiểm tra web có cho nhúng không,
  phân quyền admin ở máy chủ. Dashboard điện thoại chưa có lối vào màn Nội dung điện thoại.

## L2. Trang “Về tôi” — Câu chuyện người sáng lập

- **Mục đích:** trang giới thiệu người sáng lập trên web bán khóa học.
- **Người dùng:** khách truy cập.
- **Bản chất:** nội dung tĩnh trên bảng (`project/About.dc.html`, khung “5 · Giới thiệu về tôi”, trang “Bán hàng”).
  Không có backend hay CMS.
- **Điểm bắt đầu:** mục “Về tôi” trên menu chính của các màn bán hàng.
- **Nội dung, theo thứ tự:** tiêu đề “Câu chuyện người sáng lập” → câu trích dẫn (nền tím nhạt, viền) →
  “Câu chuyện của tôi – Từ Engine Cadet đến Chief Engineer” → “Tầm nhìn Marine Engine Academy” →
  thông điệp (nền tối) → lưu ý hành trình cá nhân (chữ thường, không ẩn). Nguyên văn do chủ dự án cung cấp.
- **Đã bỏ:** nội dung mẫu bị trùng (ô ảnh chân dung, “[Họ và tên]”, số liệu, mốc hành trình, câu trích dẫn mẫu, ô chứng chỉ).
- **Giữ nguyên:** menu, nút “Học thử miễn phí” / “Xem các khóa học”, khối liên hệ Zalo/Messenger
  (link vẫn là `#`), chân trang (còn chỗ trống “[Tên hộ kinh doanh] · [Địa chỉ] · [Mã số thuế]” từ trước).
- **Đã kiểm chứng:** so tự động với nguyên văn, **17/17 đoạn khớp**, đúng thứ tự, không lặp. Cấu trúc thẻ ổn.
- **Chưa kiểm chứng:** hiển thị trên máy tính và điện thoại trong trình duyệt.
  Bảng chưa có khung “Về tôi” riêng cho điện thoại.

## L4. Website bán khóa học theo quy trình mới (mục 6 và 8A) — thêm ngày 28/10/2026

- **Nguồn yêu cầu:** `Quy_trinh_xay_dung_app_tieng_Anh_cho_thuyen_vien_may_bo_sung_ho_so_hoc_vien.docx`, mục 6 (các trang cần có)
  và mục 8A (thu thập thông tin, hồ sơ học viên).
- **Bản chất:** 6 khung thiết kế mới trên trang “Bán hàng” của bảng, hàng thứ hai (y = 4020). Không có backend, không lưu,
  không gửi OTP/email thật. Mọi dữ liệu trên khung là mẫu.
- **Khung và luồng:**
  - `Catalog.dc.html` (6 · Danh sách khóa học): lọc theo nhóm Giao tiếp / Chuyên ngành / Phỏng vấn.
    Có 3 khóa ★ và khóa “Tìm hiểu tàu dầu” (sắp ra mắt), cùng combo. Giá là giá đề xuất, chờ chốt.
  - `Login.dc.html` (7 · Đăng ký / đăng nhập):
    - tab Tạo tài khoản / Đăng nhập; nút Google;
    - biểu mẫu 3 trường: tên hiển thị, **một** liên hệ (điện thoại **hoặc** email), chức danh;
    - ô nhận tin quảng cáo tách riêng, không tích sẵn; thông báo ngắn về mục đích, thời hạn lưu [chờ duyệt] và nơi sửa/xóa;
    - bước nhập mã 6 số (minh họa, ghi rõ không gửi thật);
    - xong thì chọn “Hoàn thiện hồ sơ” hoặc “Để sau”. Quyền lợi hiện ở cột trái, chỗ chưa có nội dung để [chờ anh chốt].
  - `MyCourses.dc.html` (8 · Khóa học của tôi): khóa đã mua có tiến độ và “Học tiếp trong app”, khóa đang học thử có “Mua khóa”,
    hướng dẫn cài PWA (Android/iPhone) và tải bài để học khi mất mạng, link yêu cầu hoàn tiền, mẫu trạng thái trống.
  - `Account.dc.html` (9 · Tài khoản của tôi):
    - thẻ “Hoàn thiện hồ sơ – nhận tài liệu phù hợp với bạn”, thanh % hoàn thiện có nút “Để sau”;
      nút nhận chỉ mở khi đủ chức danh, loại tàu và chủ đề;
    - 3 nhóm thông tin: cơ bản (bắt buộc tên và liên hệ), nghề nghiệp, nhu cầu đào tạo (tự nguyện);
    - ô nhận tin quảng cáo, có ghi lần thay đổi gần nhất;
    - dữ liệu hệ thống ghi (chỉ xem);
    - yêu cầu xem / sửa / xóa tài khoản, xóa có hộp xác nhận.
  - `Policies.dc.html` (10 · Chính sách): tab Bảo mật / Hoàn tiền / Điều khoản. Chỉ gồm các ý đã có trong quy trình;
    văn bản pháp lý, thời hạn lưu, đơn vị chịu trách nhiệm để [chờ duyệt]. Hoàn 100% trong 7 ngày nếu học dưới 3 bài
    ghi là đề xuất chờ chốt.
  - `Contact.dc.html` (11 · Liên hệ): Zalo, Messenger, email đều để [chờ anh cung cấp], kèm mục tự xử lý nhanh.
- **Liên kết:** các khung mới liên kết với nhau và với `Home`, `Course`, `Checkout`, `About`.
  `Home.dc.html` **chưa** trỏ tới khung mới (menu “Đăng nhập” và các link chân trang vẫn là `#`),
  vì chủ dự án đang sửa tay `Home`; chưa đụng vào.
- **Đã kiểm chứng:**
  - cân bằng thẻ HTML và cú pháp hole: đạt với cả 6 khung; `canvas.json` hợp lệ;
  - chạy thử logic bằng Node: lọc danh sách, kiểm tra 3 trường và các bước đăng ký, ô quảng cáo không tích sẵn,
    % hoàn thiện, điều kiện nhận quà, xác nhận xóa, chuyển tab chính sách — đều đạt.
- **Chưa kiểm chứng:** hiển thị trong trình duyệt (máy tính và điện thoại).
- **Quyết định 30/10/2026:** đăng nhập bằng email, Google, hoặc số điện thoại nhận mã qua Zalo (ZNS), không dùng SMS.
  Một tài khoản gắn được nhiều cách đăng nhập; học viên tự liên kết trong `Account`, admin gộp tay khi đã lỡ có hai tài khoản.
  Các khung trên bảng chưa thể hiện phần liên kết và ghi chú Zalo.
- **Chưa triển khai:** đăng nhập thật (Auth.js), gửi mã, lưu hồ sơ, nhật ký đồng ý, cấu hình chương trình quyền lợi trên trang quản trị,
  trang quản trị học viên và xuất CSV theo mục 8A.

## L6. Thông tin người mua khi bấm “Mua khóa học” — 29/10/2026, đã đăng (bảng công khai, phiên bản `1793281656-0535`)

- **Yêu cầu của chủ dự án:** bấm Mua khóa học → màn điền tên, số điện thoại, email, chức danh.
- **Khung:** `BuyerInfo.dc.html` (12 · Thông tin người mua), trang “Bán hàng”.
  Bản đã soạn nằm ở `docs/design/canvas-pending/project/`.
- **Luồng:** Danh sách khóa / Khóa học của tôi / (dự kiến) Chi tiết khóa → Thông tin người mua → kiểm tra lại → `Checkout.dc.html` (VietQR).
- **Trường:** họ tên, số điện thoại (định dạng Việt Nam), chức danh, ô đồng ý điều khoản + hoàn tiền là bắt buộc;
  email tùy chọn mặc định (tweak `emailRequired` bật bắt buộc), vì mục 8A ghi không bắt nhập đồng thời email và số điện thoại.
  Ô nhận quảng cáo không tích sẵn. Tweak `signedIn` mô phỏng điền sẵn từ tài khoản.
- **Đơn hàng:** hiện giá; ghi rõ giá do hệ thống tính, QR hết hạn sau 15 phút.
- **Quyết định 29/10/2026:** thanh toán dùng ảnh QR có sẵn; SePay theo dõi tài khoản và gửi webhook, hệ thống tự xác nhận
  theo mã đơn trong nội dung chuyển khoản và số tiền. Sai nội dung thì admin cấp tay, bắt buộc nhập mã giao dịch ngân hàng.
  Giữ hạn đơn 15 phút, tính theo thời điểm giao dịch ngân hàng trong webhook (SePay gửi lại webhook lỗi tới ~33 phút).
  Webhook SePay dùng xác thực HMAC-SHA256 + kiểm tra timestamp. Mã đơn là chuỗi ngẫu nhiên không trùng (đề xuất `ME` + 8 ký tự, ví dụ `ME7K3QX9`;
  bản thiết kế đang dùng ví dụ `ME1055`). Chưa dùng payOS. Chi tiết: CLAUDE.md, `docs/session-handoff.md` mục 11. Chữ về 15 phút và
  khóa tự mở trên `BuyerInfo`, `Checkout`, `MobileCheckout` khớp cách này, nhưng các màn còn chữ lệch khác (payOS, “điền sẵn”, nút
  “Tạo mã VietQR”), xem `docs/ui-review-2026-10-30.md`. Mới là thiết kế, chưa có backend.
- **Kiểm chứng:** logic 6/6 tình huống đạt bằng Node; cấu trúc thẻ đạt. Ngày 30/10 đã xem bằng Chrome headless (ảnh mặc định
  và trạng thái báo lỗi / kiểm tra lại trong `docs/design/anh-chup-v1-2026-10-30/`).
- Nút “Mua khóa học” trong `Course.dc.html` đã trỏ sang `BuyerInfo.dc.html`. `Home.dc.html` (chủ dự án sửa tay) chưa đổi: nút Mua ở đó vẫn tới `Course.dc.html`.

## L7. App học theo học liệu Engine Cadet v6 — 29/10/2026, đã đăng (trang “App học” trên bảng)

- **Nguồn:** `docs/Engine_Cadet_Three_Levels_v6/Engine_Cadet_Learning_Data_v6.json` và `HUONG_DAN_BA_MUC_V6.txt`
  (94 bài, 3 khóa theo loại tàu, 11 module, 3 mức trợ giúp; học liệu bản nháp, chờ giảng viên duyệt, chưa có audio).
- **Khung (trang mới “App học”, khổ điện thoại 390px):**
  - `CadetCourse.dc.html`: chọn loại tàu (tàu dầu 89 / hàng khô 90 / container 89 bài), chọn mức mặc định,
    9 chủ đề với số bài đúng JSON, mở chủ đề A4 thấy 8 bài; bài A023-1 dẫn sang màn bài học.
  - `CadetLesson.dc.html`: bài A023-1 “Explain the two-stroke diesel engine cycle.” với 3 tab mức.
    - Mức 1: câu hỏi Việt rồi Anh, 3 cụm từ, 6 phần (3 thuật ngữ + 3 ý chính), che đáp án để tự nói, 3 bài điền từ.
    - Mức 2: dàn ý 3 ý bắt buộc, đáp án chỉ hiện sau “Tôi đã thử nói” hoặc khi xin trợ giúp, bài chọn A/B/C (đáp án C).
    - Mức 3: không dàn ý, hiện góp ý, lỗi hay gặp, đáp án mẫu và tự đối chiếu sau khi thử; ghi bài chưa có câu phụ được duyệt.
    - Lịch sử trợ giúp giữ khi đổi mức. Nút nghe và ghi âm bị khóa, ghi “chưa có audio / chưa nối dịch vụ”.
- **Kiểm chứng:** mọi câu nội dung khớp nguyên văn JSON (đối chiếu tự động); logic 15/15 tình huống đạt; cấu trúc thẻ đạt.
  Chưa xem trong trình duyệt.
- **Chưa làm:** các bài khác (dữ liệu sẵn trong JSON, khi làm app thì đọc trực tiếp), ôn tập theo lịch, ghi âm và chấm.

## L3. Hồ sơ nghề nghiệp thuyền viên — đã làm ở dự án khác, hiện ngoài phạm vi

- Ngày 28/10/2026, với sự cho phép riêng cho lần đó, giai đoạn 1 được triển khai **trong Marine Academy**
  (`C:\Users\Admin\Documents\marine-engine-academy`, Express + SQLite), **không phải** trong dự án này.
- Gồm: trang công khai `/ho-so-nghe-nghiep` (xem trước CV, lưu qua phiên OTP hoặc mật khẩu, kinh nghiệm theo chuyến,
  nguyện vọng, đồng ý tách mục, xuất / chỉnh sửa / xóa dữ liệu) và trang nội bộ `/nhan-su` (vai trò nhân sự riêng,
  tìm kiếm theo điều kiện, xuất CSV có nhật ký).
- Thiết kế đầy đủ, từ điển dữ liệu, ma trận quyền: `docs/career-profile.md` **trong repo Marine Academy**.
- Kết quả lúc đó: 68/68 kiểm thử; 23/23 bảng cũ giữ nguyên; có bản sao lưu database trước khi thêm bảng.
  Chưa commit. Giao diện chỉ được mở trong trình duyệt, chưa kiểm tra tận mắt. OTP (Twilio) chưa cấu hình,
  nên khách chưa mua khóa học chưa lưu được hồ sơ.
- **Từ 28/10/2026, chủ dự án yêu cầu chỉ làm cho dự án này.** Không đọc, sửa hay chạy code Marine Academy nếu chưa được cho phép lại.
  Bảng thiết kế **chưa có** màn Hồ sơ nghề nghiệp.

## L5 Trợ lý AI 3D dùng chung cho website và app

- **Yêu cầu ngày 28/10/2026:** bổ sung các luồng đã trao đổi vào tệp quy trình xây dựng app tiếng Anh.
- **Tệp đã cập nhật:** `Quy_trinh_xay_dung_app_tieng_Anh_cho_thuyen_vien_may_bo_sung_ho_so_hoc_vien.docx`, là bản mới nhất đã có mục 5A và 8A. Giữ nguyên hai bản Word cũ.
- **Phần mới:** mục **7A Xây dựng và tích hợp trợ lý AI 3D**, trước mục thanh toán. Có 11 luồng A1–A11: dựng nhân vật từ ảnh; soạn và duyệt giáo án; hướng dẫn website; tư vấn khóa; chuyển thanh toán và nhận quyền; dạy và tiếp tục bài; ba giọng và phát âm; hội thoại tự do; ngoại tuyến và đồng bộ; cấu hình và phân quyền; lỗi và hỗ trợ.
- **Bổ sung liên quan:** kiến trúc dùng chung, nguồn kiến thức có phạm vi và phiên bản, dữ liệu và thời hạn lưu, màn hình web/app/quản trị, hạn mức và chi phí, lộ trình bản thử và tiêu chí nghiệm thu. Nối yêu cầu vào mục sản xuất nội dung, website, app, lộ trình, chi phí và các quyết định cần chốt.
- **Quy tắc:** giáo án do anh duyệt, phần mềm quản lý bước học; máy chủ kiểm tra quyền ở mỗi lần lấy tài liệu hoặc dùng công cụ; quyền học theo `enrollments`; trợ lý không tự mở khóa/sửa giá/hoàn tiền/đổi vai trò. Chỉ bật micro sau thao tác và quyền người dùng. Ba giọng tiếng Anh Philippines, Ấn Độ, Mỹ; có tiếng Việt giải thích.
- **Ngoại tuyến:** dùng bài có kịch bản và audio đã tải; hội thoại đám mây và chấm phát âm qua dịch vụ cần mạng. Không giả lập câu trả lời hoặc điểm khi lỗi; đồng bộ có mã sự kiện và kiểm tra lại quyền. Thời hạn quyền học ngoại tuyến cần chốt trước ra mắt.
- **Trạng thái:** mới cập nhật tài liệu quy trình. Chưa có ảnh mới, mô hình 3D, mã nguồn, cơ sở dữ liệu, API hoặc màn hình trợ lý mới trên bảng.
- **Kiểm tra:** đọc lại DOCX, đối chiếu toàn bộ đoạn gốc theo thứ tự, chỉ cho phép 11 đoạn sửa có chủ đích; đủ 11 luồng, 11 bảng và 2 ảnh nhúng được giữ. Công cụ render không chạy vì máy thiếu LibreOffice; chưa xác minh bố cục bằng ảnh trang.
