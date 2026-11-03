import { describe, expect, it } from "vitest";
import { crc16, vietQrPayload } from "@/modules/orders/vietqr";

// Chuỗi VietQR (chuẩn EMVCo của Napas) đã điền số tiền và nội dung, để khách quét là chuyển đúng.
const fields = (s: string) => {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length;) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
};

describe("VietQR", () => {
  it("CRC-16/CCITT-FALSE đúng chuẩn", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("có ngân hàng, tài khoản, số tiền, nội dung là mã đơn; mã kiểm tra khớp", () => {
    const p = vietQrPayload({ bin: "970422", accountNo: "0123456789", amountVnd: 199000, content: "ME7K3QX9AB" });
    const f = fields(p);
    expect(f["00"]).toBe("01");
    expect(f["01"]).toBe("12");
    const merchant = fields(f["38"]!);
    expect(merchant["00"]).toBe("A000000727");
    expect(fields(merchant["01"]!)).toEqual({ "00": "970422", "01": "0123456789" });
    expect(merchant["02"]).toBe("QRIBFTTA");
    expect(f["53"]).toBe("704");
    expect(f["54"]).toBe("199000");
    expect(f["58"]).toBe("VN");
    expect(fields(f["62"]!)["08"]).toBe("ME7K3QX9AB");
    expect(p.slice(-8, -4)).toBe("6304");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("từ chối dữ liệu sai thay vì tạo mã chuyển nhầm", () => {
    expect(() => vietQrPayload({ bin: "97042", accountNo: "0123456789", amountVnd: 1, content: "ME1" })).toThrow();
    expect(() => vietQrPayload({ bin: "970422", accountNo: "01 23", amountVnd: 1, content: "ME1" })).toThrow();
    expect(() => vietQrPayload({ bin: "970422", accountNo: "0123456789", amountVnd: 0, content: "ME1" })).toThrow();
    expect(() => vietQrPayload({ bin: "970422", accountNo: "0123456789", amountVnd: 1.5, content: "ME1" })).toThrow();
    expect(() => vietQrPayload({ bin: "970422", accountNo: "0123456789", amountVnd: 1, content: "có dấu" })).toThrow();
  });
});
