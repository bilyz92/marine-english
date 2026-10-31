import { expect, it } from "vitest";
import { publicKeyringFromSeeds } from "@/worker/license-keys";
import { publicLicenseKeys } from "@/modules/learn/license";
import { parsePublicKeyring } from "@/lib/offline/license-verify";

it("CLI tạo chuỗi khóa công khai khớp khóa máy chủ dùng để ký", () => {
  const ring = publicKeyringFromSeeds(process.env.LICENSE_SIGNING_KEYS!);
  expect(parsePublicKeyring(ring)).toEqual(publicLicenseKeys());
  expect(() => publicKeyringFromSeeds("l1:ngan")).toThrow();
});
