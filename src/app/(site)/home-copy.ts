// Câu chữ "cách mua" ở trang chủ, theo đúng cách mua đang chạy (chủ 17/11/2026): SePay bật thì tiền về là tự mở khóa; khách chưa
// có tài khoản mua được khi máy chủ gửi được email (thông tin đăng nhập chỉ gửi qua email, 2026-11-16-guest-orders.md).

type Step = { title: string; text: string };

export function buyFlowCopy({ autoConfirm, guestOpen }: { autoConfirm: boolean; guestOpen: boolean }): { steps: Step[]; paidAnswer: string } {
  const first: Step = guestOpen
    ? { title: "Chọn khóa, bấm Mua", text: "Điền họ tên, số điện thoại và email. Chưa cần có tài khoản." }
    : { title: "Tạo tài khoản, chọn khóa", text: "Đăng nhập hoặc tạo tài khoản bằng số điện thoại, rồi bấm Mua ở khóa học." };
  const qr: Step = { title: "Quét mã QR bằng app ngân hàng", text: "Mọi ngân hàng Việt Nam đều quét được. Kiểm tra đúng số tiền và nội dung là mã đơn." };
  // SePay tắt mà khách mua không cần tài khoản: đơn khách không có nút "Tôi đã chuyển khoản", chủ xác nhận khi thấy tiền.
  if (!autoConfirm && guestOpen) {
    return {
      steps: [first, qr, { title: "Chủ khóa học xác nhận, khóa học mở", text: "Chuyển xong, chủ khóa học xác nhận khi thấy tiền rồi gửi thông tin đăng nhập vào email của bạn." }],
      paidAnswer: "Đã có tài khoản: chuyển xong, bấm “Tôi đã chuyển khoản” trên trang thanh toán là học được ngay; chúng tôi đối chiếu sao kê sau. "
        + "Mua khi chưa có tài khoản: chủ khóa học xác nhận khi thấy tiền, rồi gửi thông tin đăng nhập vào email của bạn.",
    };
  }
  if (!autoConfirm) {
    return {
      steps: [first, qr, { title: "Bấm “Tôi đã chuyển khoản”, vào học", text: "Chuyển xong, bấm nút trên trang thanh toán là khóa học mở ngay." }],
      paidAnswer: "Học được ngay: chuyển xong, bấm “Tôi đã chuyển khoản” trên trang thanh toán. Chúng tôi đối chiếu sao kê sau. Nếu chưa thấy tiền, khóa học tạm khóa và báo lý do; bạn gửi ảnh chuyển khoản để chúng tôi kiểm lại.",
    };
  }
  return {
    steps: [
      first,
      qr,
      {
        title: "Tiền về, khóa học tự mở",
        text: guestOpen
          ? "Thường chỉ vài phút. Hệ thống tạo tài khoản và gửi thông tin đăng nhập vào email của bạn."
          : "Thường chỉ vài phút. Khóa học mở ngay trong tài khoản của bạn.",
      },
    ],
    paidAnswer: "Thường chỉ vài phút: hệ thống tự nhận tiền và mở khóa học khi bạn chuyển đúng số tiền, ghi đúng nội dung là mã đơn."
      + (guestOpen ? " Nếu bạn mua khi chưa có tài khoản, thông tin đăng nhập được gửi vào email." : "")
      + " Chuyển sai số tiền hoặc thiếu mã đơn thì chúng tôi đối chiếu tay và liên hệ bạn.",
  };
}
