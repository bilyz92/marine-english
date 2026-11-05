// Lời báo dùng chung cho đăng ký/đăng nhập bằng số + mật khẩu (trang đăng nhập và trang mua).

export const WEAK: Record<string, string> = {
  too_short: "Mật khẩu cần ít nhất 8 ký tự.",
  too_long: "Mật khẩu dài quá 128 ký tự.",
  common: "Mật khẩu này quá dễ đoán, chọn mật khẩu khác.",
  phone: "Không dùng chính số điện thoại làm mật khẩu.",
};

export const MESSAGE: Record<string, string> = {
  invalid_phone: "Số điện thoại không đúng. Nhập số di động Việt Nam, ví dụ 0912 345 678.",
  phone_taken: "Số này đã có tài khoản. Chọn Đăng nhập, hoặc Quên mật khẩu.",
  throttled: "Thử đăng ký quá nhiều lần. Đợi một giờ rồi thử lại.",
  invalid: "Số điện thoại hoặc mật khẩu không đúng.",
  locked: "Sai quá nhiều lần. Đợi 15 phút rồi thử lại, hoặc dùng Quên mật khẩu.",
  invalid_code: "Mã không đúng hoặc đã hết hạn. Gửi mã mới rồi thử lại.",
  network: "Không kết nối được. Kiểm tra mạng rồi bấm lại.",
};
