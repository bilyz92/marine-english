# Ảnh chụp giao diện v1 (30/10/2026)

18 màn trong `docs/design/giao-dien-v1/`, chụp bằng Chrome headless qua `node serve.js`. Chiều rộng theo `canvas.json`
(máy tính 1440px, điện thoại 390px). Chiều cao lấy theo khung trong `canvas.json`, hoặc theo nội dung thật cộng 24px nếu nội dung
dài hơn khung, để ảnh không bị cắt. Đây là lần đầu bộ giao diện được xem bằng trình duyệt thật. Ảnh chụp trạng thái mặc định
của từng màn, chưa bấm thử.

Ngoài 18 ảnh mặc định còn 6 ảnh biến thể chọn qua địa chỉ (tweak), tên dạng `<Màn>__<biến thể>.png`:
`BuyerInfo__emailRequired`, `BuyerInfo__signedIn`, `CadetLesson__developing` (mức 2), `CadetLesson__independent` (mức 3),
`Content__list`, `ContentMobile__list`.

Thư mục `trang-thai/` có 16 ảnh trạng thái phải bấm mới thấy, chụp bằng `docs/design/tools/chup-trang-thai.mjs`: Checkout thành công /
hết hạn / áp mã giảm giá; Login tab đăng nhập / báo lỗi / nhập mã / xong; BuyerInfo báo lỗi / kiểm tra lại; Mobile cấp khóa;
Policies hoàn tiền / điều khoản; Account xác nhận xóa; Catalog lọc phỏng vấn; CadetLesson mức 2 sau khi thử nói; CadetCourse mở chủ đề A1.
Kết quả rà soát: `docs/ui-review-2026-10-30.md`.

Năm màn có nội dung dài hơn khung trên bảng: `Home` (4221 so với 3900), `Main` (2094 so với 1760), `Mobile` (1846 so với 1700),
`CadetCourse` (1937 so với 1900), `MobileCheckout` (1327 so với 1300). Ba màn điện thoại cuối không có `expand: fill` trong
`canvas.json`, nên trên bảng có thể bị cắt phần cuối.

Danh sách chữ lệch với các quyết định 29–30/10 và lỗi bố cục thấy trên ảnh: `docs/session-handoff.md`, mục “Kiểm tra giao diện
30/10/2026”. Chụp lại khi giao diện đổi; không sửa tay ảnh.
