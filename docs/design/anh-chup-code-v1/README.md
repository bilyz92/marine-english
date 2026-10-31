# Ảnh chụp giao diện đã code (P5b, 31/10/2026)

Chụp bằng Chrome không giao diện qua `tests/e2e-ui/` trên máy chủ dev, dữ liệu thử (khóa Engine Cadet tanker, giá 199.000đ đặt để thử, ảnh QR là biểu tượng app thay cho ảnh thật). Đây không phải bảng thiết kế: so với `docs/design/giao-dien-v1/` và mục 10 của tab Spec.

Chạy lại:

- `node tests/e2e-ui/shots.mjs <địa chỉ> <thư mục>`: trang công khai ở 360, 390, 1280 px.
- `node tests/e2e-ui/purchase.mjs <địa chỉ> <mã khóa> <thư mục>`: mua trọn đường, webhook có chữ ký giả lập (22 điểm kiểm).
- `node tests/e2e-ui/admin.mjs <địa chỉ> <mã khóa> <thư mục>`: vận hành quản trị bằng vai trò chủ và hỗ trợ (64 điểm kiểm).

Mỗi trang được kiểm tự động: không tràn ngang, mọi ô nhập có nhãn, mọi nút có tên, không gọi ra ngoài domain, không lỗi trang, không còn chữ cấm (`payOS`, `điền sẵn`, `[chờ`, `Dữ liệu mẫu`).

## Trạng thái từng màn

| Màn | Đang tải | Rỗng | Lỗi / mất mạng | Không có quyền | Thành công | Cách kiểm |
| --- | --- | --- | --- | --- | --- | --- |
| Trang chủ, Khóa học | có | “Sắp ra mắt” khi chưa mở bán khóa nào | trang lỗi của Next | — | có | shots.mjs |
| Chi tiết khóa, Học thử | có | — | khóa nháp hay bài không học thử: trang 404 | — | có | shots.mjs, `purchase.test.ts` |
| Mua (WEB-04) | có | — | chưa đồng ý; chưa mở thanh toán; đã có khóa; lỗi tạo đơn | chưa đăng nhập → đăng nhập rồi quay lại | có | purchase.mjs |
| Thanh toán (WEB-05/06) | có | — | mất mạng: giữ thông tin, báo đang thử lại; đơn không có: báo | chưa đăng nhập → đăng nhập | đã thanh toán, hết hạn, đã hoàn, cần đối chiếu tay | purchase.mjs, `purchase.test.ts` |
| Tổng quan, Đơn hàng, Học viên, Sổ giao dịch, Hoàn tiền, Khóa học, Quản trị viên, Job | có | có câu riêng | có, kèm nút thử lại | “không có quyền xem” | có | admin.mjs |
| Hộp xác nhận | — | — | lỗi hiện trong hộp, hộp không đóng | — | đóng và tải lại | admin.mjs (Escape, focus quay về nút) |

- `node tests/e2e-ui/keyboard.mjs <địa chỉ> <mã khóa> <thư mục>`: chỉ dùng bàn phím trên trang mua và thanh toán (Tab tới ô đồng ý, Space tích, Enter sang thanh toán, Tab tới 3 nút chép, mọi chỗ dừng có viền focus 2px), và nhánh đăng nhập Google quay về đúng trang mua (12 điểm kiểm).

## Chưa kiểm

- Trình đọc màn hình (VoiceOver, TalkBack): chưa thử, cần người thử trên điện thoại thật.
