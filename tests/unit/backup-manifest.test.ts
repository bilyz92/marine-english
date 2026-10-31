import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COUNT_TABLES, manifestMac, validateManifest, verifyManifestMac } from "../../deploy/manifest-check.mjs";

const good = {
  version: 1, name: "20261031-023000", createdAt: "2026-10-31T02:30:00.000Z", kid: "k1",
  dump: { file: "db.dump.gpg", bytes: 10, sha256: "a".repeat(64) }, migration: "20261031130000_purchase_terms",
  counts: { orders: 1, bank_transactions: 2, enrollments: 3 },
  media: [{ sha256: "b".repeat(64), kid: "k1", visibility: "public", storageKey: `${"b".repeat(64)}.png` }],
};

describe("kiểm manifest trước khi khôi phục", () => {
  it("manifest hợp lệ → qua", () => {
    expect(validateManifest(good)).toEqual(good);
    expect(COUNT_TABLES).toEqual(["orders", "bank_transactions", "enrollments"]);
  });

  it.each([
    ["tên bảng lạ trong counts (chèn SQL)", { counts: { ...good.counts, "orders; DROP TABLE users; --": 1 } }],
    ["thiếu bảng đếm", { counts: { orders: 1 } }],
    ["kid có ký tự lạ (đường dẫn)", { kid: "../k1" }],
    ["tệp dump khác tên", { dump: { ...good.dump, file: "../../etc/passwd" } }],
    ["storageKey thoát thư mục", { media: [{ ...good.media[0], storageKey: "../../x.png" }] }],
    ["visibility lạ", { media: [{ ...good.media[0], visibility: "secret" }] }],
    ["sha256 sai dạng", { media: [{ ...good.media[0], sha256: "zz" }] }],
    ["migration có ký tự lạ", { migration: "x'; DROP" }],
  ])("%s → từ chối", (_name, patch) => {
    expect(() => validateManifest({ ...good, ...patch })).toThrow();
  });

  it("MAC theo khóa: đúng khóa → qua; sửa manifest hoặc sai khóa → từ chối", () => {
    const raw = Buffer.from(JSON.stringify(good));
    const mac = manifestMac(raw, "mat-khau-k1\n");
    expect(mac).toBe(createHmac("sha256", "mat-khau-k1\n").update(raw).digest("hex"));
    expect(verifyManifestMac(raw, mac, "mat-khau-k1\n")).toBe(true);
    expect(verifyManifestMac(Buffer.from(JSON.stringify({ ...good, kid: "k2" })), mac, "mat-khau-k1\n")).toBe(false);
    expect(verifyManifestMac(raw, mac, "khoa-khac")).toBe(false);
    expect(verifyManifestMac(raw, "khong-phai-hex", "mat-khau-k1\n")).toBe(false);
  });
});
