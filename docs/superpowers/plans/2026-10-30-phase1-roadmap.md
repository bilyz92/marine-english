# Giai đoạn 1 — lộ trình các plan

Phạm vi: `docs/design-gates-2026-10-30.md` §10 (G3 đóng 30/10/2026). Thiết kế: `docs/technical-design-draft-2026-10-30.md`.
D1 duyệt (tự quản lý phiên, không Auth.js). G2 được chủ dự án hoãn (code trước, Spec + giao diện cập nhật trước ra mắt).
Giai đoạn 1 chia 5 plan nối tiếp; mỗi plan cho ra phần mềm chạy và test được. Viết plan sau khi plan trước xong (để dùng đúng giao diện đã có).

| Plan | Nội dung | Chặn bởi cổng | Trạng thái |
| --- | --- | --- | --- |
| P1 | Nền tảng repo, Docker dev, Prisma + vai trò DB, khung test, phiên tự quản lý (học viên + quản trị), OTP email, Google OIDC, thiết bị, liên kết định danh, tài khoản quản trị + nhật ký | G7 (gửi email thật — làm adapter dev trước), G10 (giới hạn thiết bị dùng giá trị đề xuất, có cấu hình) | `2026-10-30-p1-foundation-auth.md` |
| P2 | Khóa học + nội dung (nhập JSON Engine Cadet), đơn + ảnh chụp + mã đơn + mã giảm giá, sổ giao dịch, webhook SePay (chữ ký giả lập trong test), phân loại, hàng chờ, ghép tay, hoàn tiền, quyền học, trang quản trị tiền | G4/G5 cho chạy thật (code theo hợp đồng giả lập, điền khi G4 xong), G11, G13 | `2026-10-30-p2-courses-orders-ledger.md` |
| P3 | App học PWA: trang khóa/bài theo giao diện v1, manifest, tải tệp được bảo vệ, giấy phép offline, đồng bộ sự kiện, tiến độ | G9, G10 | chưa viết |
| P4 | Worker: lease job, outbox (email/Telegram), job định kỳ, đối soát SePay, nhật ký job + “chạy ngay”, cảnh báo | G4, G7 | chưa viết |
| P5 | Triển khai VPS: Compose prod, Caddy, vai trò DB, deploy CI, sao lưu + khôi phục thử, runbook; chuyển giao diện bán hàng còn lại | G8 | chưa viết |

Đăng nhập bằng số điện thoại qua Zalo: chỉ làm adapter và cờ cấu hình tắt mặc định trong P1; bật khi G6, G15 và phần G12a liên quan đóng.
Mọi plan: TDD, Postgres thật trong test, commit nhỏ (cục bộ; không push/deploy khi chủ dự án chưa yêu cầu), `/codex-impl-review` trước mỗi commit theo CLAUDE.md của người dùng.
