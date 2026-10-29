# Công cụ chụp ảnh giao diện

Dùng để chụp lại bộ ảnh trong `docs/design/anh-chup-…/` khi giao diện đổi. Chỉ chạy trên máy (127.0.0.1), không gửi gì ra ngoài.

## Ảnh mặc định và biến thể (Chrome headless)

```bash
cd docs/design/giao-dien-v1 && node serve.js            # cửa sổ 1, giữ chạy
google-chrome --headless=new --no-sandbox --hide-scrollbars --virtual-time-budget=4000 \
  --window-size=1440,7000 --screenshot=Home.png "http://127.0.0.1:5173/Home.dc.html"
```

Chụp cao 7000px rồi cắt theo chiều cao nội dung thật (cộng 24px), không cắt theo khung trong `canvas.json`: năm màn dài hơn khung.
Biến thể chọn qua địa chỉ, ví dụ `BuyerInfo.dc.html?signedIn=true`, `CadetLesson.dc.html?startLevel=developing`.

## Trạng thái phải bấm — `chup-trang-thai.mjs`

Điều khiển Chrome qua cổng gỡ lỗi để bấm nút, điền biểu mẫu rồi chụp. Cần Node 22 trở lên (dùng `WebSocket` có sẵn).

```bash
cd docs/design/giao-dien-v1 && node serve.js                                   # cửa sổ 1
google-chrome --headless=new --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --user-data-dir=/tmp/chrome-chup about:blank                            # cửa sổ 2
node docs/design/tools/chup-trang-thai.mjs <thư-mục-ảnh> [tiền-tố-tên]          # cửa sổ 3
```

Danh sách kịch bản nằm trong mảng `scenarios` của tệp. Nút được tìm theo chữ hiển thị, nên đổi chữ trên giao diện thì sửa kịch bản theo.
Ảnh dựng bằng `support.js` (bộ chạy xem trước tự viết), không phải bộ chạy gốc của Claude Design; chi tiết nhỏ có thể khác bảng.
