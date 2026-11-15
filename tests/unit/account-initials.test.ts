import { expect, it } from "vitest";
import { initials } from "@/app/(site)/account-menu";

it("vòng chữ trên nút tài khoản: chữ cái đầu hai từ cuối tên, viết hoa; tên rỗng → ?", () => {
  expect(initials("Nguyễn Việt Hưng")).toBe("VH");
  expect(initials("  đức  ")).toBe("Đ");
  expect(initials("thuyen.vien")).toBe("T");
  expect(initials("")).toBe("?");
  expect(initials("   ")).toBe("?");
});
