// Công tắc tính năng. Phần trang dựng sẵn (chân trang, trang chính sách) đọc lúc build: đổi thì build lại.

/** Hoàn tiền: chủ dự án yêu cầu ẩn khỏi giao diện (02/11/2026). Mã, API quản trị và dữ liệu giữ nguyên để bật lại;
 *  khi tắt, học viên không tự gửi yêu cầu hoàn tiền được (API trả 404). Bật: ME_REFUNDS_UI=true (dùng khi chạy
 *  tests/e2e-ui/admin.mjs, purchase.mjs, hoặc khi chủ mở lại hoàn tiền). */
export const REFUNDS_UI = process.env.ME_REFUNDS_UI === "true";
