// Từ khóa riêng ký giấy phép (LICENSE_SIGNING_KEYS, "kid:base64 32 byte,…") ra chuỗi khóa công khai để nhúng vào bản app
// lúc build (NEXT_PUBLIC_LICENSE_PUBLIC_KEYS). Không dùng alias để CLI chạy thẳng bằng Node.
import { createPrivateKey, createPublicKey } from "node:crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function publicKeyringFromSeeds(seeds: string): string {
  return seeds
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const kid = part.slice(0, part.indexOf(":"));
      const seed = Buffer.from(part.slice(part.indexOf(":") + 1), "base64");
      if (!kid || seed.length !== 32) throw new Error(`Khóa "${kid}" phải là 32 byte`);
      const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
      return `${kid}:${createPublicKey(key).export({ format: "jwk" }).x}`;
    })
    .join(",");
}
