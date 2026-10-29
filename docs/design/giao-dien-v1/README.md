# Giao diện Marine English v1 (bản chốt 29/10/2026)

Bản tải về từ bảng thiết kế https://claude.ai/artifact/GGG6B1yonpRgD2FQ5hizCy, phiên bản `1793281656-0535`.
Spec của từng màn: tab "Spec giao diện v1 (chốt 29/10)" trong https://claude.ai/artifact/ENwhHxGCF4bSKAUXrbSrLD.

## Cách mở

- **Bấm đúp `Mo-giao-dien.cmd`**: trình duyệt mở `http://localhost:5173/` với danh sách 18 màn. Đóng cửa sổ đen để dừng.
  Cần Node.js (máy này đã có).
- Hoặc chạy `node serve.js --open` trong thư mục này.
- Mở thẳng tệp `.dc.html` bằng trình duyệt cũng xem được, nhưng bảng đơn hàng ở `Main.dc.html` có thể hiển thị sai,
  vì trình duyệt không cho đọc mã gốc khi mở bằng `file://`.
- Thử tweak qua địa chỉ, ví dụ `BuyerInfo.dc.html?emailRequired=true`, `BuyerInfo.dc.html?signedIn=true`,
  `CadetLesson.dc.html?startLevel=developing`, `Content.dc.html?startWith=list`.

## Trong thư mục

| Tệp | Là gì |
| --- | --- |
| `*.dc.html` (19 tệp) | Mã nguồn từng màn, giữ nguyên từng byte như trên bảng (đã đối chiếu sha256) |
| `canvas.json` | Sơ đồ bảng: tên, kích thước, trang của từng màn |
| `index.html` | Trang mục lục 18 màn theo nhóm Bán hàng / Quản trị / App học |
| `support.js` | Bộ chạy xem trước viết riêng cho thư mục này; không phải bộ chạy gốc của Claude Design |
| `serve.js`, `Mo-giao-dien.cmd` | Máy chủ nhỏ chỉ chạy trên máy (127.0.0.1) để xem |

## Lưu ý

- Đây là bản thiết kế bấm thử: dữ liệu là mẫu, không có máy chủ, tải lại trang là mất.
- Phông chữ Be Vietnam Pro tải từ Google Fonts; khi không có mạng, trang dùng phông hệ thống.
- Sửa giao diện thì sửa trên bảng thiết kế và ghi vào tab Spec, rồi tải lại thư mục này; không sửa tay các tệp `.dc.html` ở đây.
