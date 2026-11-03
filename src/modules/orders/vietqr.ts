// Chuỗi VietQR (chuẩn EMVCo QR của Napas 247) cho một đơn: ngân hàng, tài khoản, số tiền và nội dung là mã đơn.
// Khách quét bằng app ngân hàng là đủ thông tin, không phải gõ tay (tránh chuyển sai số tiền hay thiếu mã đơn).
// Chỉ dựng chuỗi; trình duyệt vẽ thành ảnh QR tại chỗ, không gửi thông tin đơn ra dịch vụ ngoài.

/** Số tài khoản dùng được trong VietQR (tối đa 19 ký tự chữ/số). */
export const VIETQR_ACCOUNT = /^[0-9A-Za-z]{1,19}$/;

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF), 4 ký tự hex in hoa. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function vietQrPayload(input: { bin: string; accountNo: string; amountVnd: number; content: string }): string {
  if (!/^\d{6}$/.test(input.bin)) throw new Error("Mã BIN ngân hàng phải gồm 6 chữ số");
  if (!VIETQR_ACCOUNT.test(input.accountNo)) throw new Error("Số tài khoản không hợp lệ");
  if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) throw new Error("Số tiền không hợp lệ");
  if (!/^[0-9A-Z]{1,25}$/.test(input.content)) throw new Error("Nội dung chuyển khoản chỉ gồm chữ in hoa không dấu và số");
  const merchant = tlv("00", "A000000727") + tlv("01", tlv("00", input.bin) + tlv("01", input.accountNo)) + tlv("02", "QRIBFTTA");
  const body =
    tlv("00", "01") + tlv("01", "12") + tlv("38", merchant) + tlv("53", "704") + tlv("54", String(input.amountVnd)) + tlv("58", "VN") +
    tlv("62", tlv("08", input.content)) + "6304";
  return body + crc16(body);
}
