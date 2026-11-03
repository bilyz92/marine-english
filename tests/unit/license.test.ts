import { describe, expect, it } from "vitest";
import { issueLicense, publicLicenseKeys } from "@/modules/learn/license";
import { verifyLicense } from "@/lib/offline/license-verify";

const input = { userId: "u1", deviceId: "d1", courses: [{ id: "c1", versionId: "v1" }] };
const DAY = 86_400;
const parts = (t: string) => t.split(".");
const decode = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString("utf8"));

describe("giấy phép offline", () => {
  it("ký và xác minh vòng tròn; đúng các claim và thời hạn 30 + 7 ngày", async () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const token = issueLicense({ ...input, now });
    const [h] = parts(token);
    expect(decode(h!)).toEqual({ alg: "EdDSA", kid: "l2", typ: "JWT" });
    const claims = await verifyLicense(token, publicLicenseKeys());
    const iat = now.getTime() / 1000;
    expect(claims).toEqual({ v: 1, sub: "u1", did: "d1", courses: input.courses, iat, exp: iat + 30 * DAY, grace: 7 * DAY });
  });

  it("khóa mở tạm có hạn riêng 3 ngày (until); khóa đã mua không có; until sai kiểu → null", async () => {
    const now = new Date("2026-11-03T00:00:00Z");
    const iat = Math.floor(now.getTime() / 1000);
    const token = issueLicense({ ...input, now, courses: [{ id: "c1", versionId: "v1" }, { id: "c2", versionId: "v2", provisional: true }] });
    const claims = await verifyLicense(token, publicLicenseKeys());
    expect(claims!.courses).toEqual([{ id: "c1", versionId: "v1" }, { id: "c2", versionId: "v2", until: iat + 3 * DAY }]);
    // Có hạn riêng → v2: app cũ (chỉ nhận v1) từ chối thay vì cho học 37 ngày. Không có khóa mở tạm → vẫn v1.
    expect(claims!.v).toBe(2);
    expect(decode(parts(issueLicense({ ...input, now }))[1]!).v).toBe(1);
  });

  it("sửa payload, sửa chữ ký, kid lạ, alg khác, sai định dạng → null", async () => {
    const keys = publicLicenseKeys();
    const [h, p, s] = parts(issueLicense(input));
    const forgedPayload = Buffer.from(JSON.stringify({ ...decode(p!), sub: "khac" })).toString("base64url");
    expect(await verifyLicense(`${h}.${forgedPayload}.${s}`, keys)).toBeNull();
    const sig = Buffer.from(s!, "base64url");
    sig[0] = sig[0]! ^ 0xff;
    expect(await verifyLicense(`${h}.${p}.${sig.toString("base64url")}`, keys)).toBeNull();
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(await verifyLicense(`${enc({ alg: "EdDSA", kid: "lạ", typ: "JWT" })}.${p}.${s}`, keys)).toBeNull();
    expect(await verifyLicense(`${enc({ alg: "none", kid: "l2", typ: "JWT" })}.${p}.${s}`, keys)).toBeNull();
    expect(await verifyLicense("rác", keys)).toBeNull();
    expect(await verifyLicense(`${h}.${p}.${s}`, [])).toBeNull();
  });

  it("đổi khóa theo giai đoạn: client chỉ tin l1 → ký bằng l1; không khai báo hoặc không tin khóa nào → khóa hiện hành", async () => {
    const kid = (t: string) => decode(parts(t)[0]!).kid;
    expect(kid(issueLicense({ ...input, trustedKids: ["l1"] }))).toBe("l1");
    expect(kid(issueLicense({ ...input, trustedKids: ["l1", "l2"] }))).toBe("l2");
    expect(kid(issueLicense(input))).toBe("l2");
    expect(kid(issueLicense({ ...input, trustedKids: ["cu-qua"] }))).toBe("l2");
    expect(await verifyLicense(issueLicense({ ...input, trustedKids: ["l1"] }), publicLicenseKeys())).not.toBeNull();
  });

  it("khóa công khai không lộ khóa riêng", () => {
    const keys = publicLicenseKeys();
    expect(keys.map((k) => k.kid)).toEqual(["l1", "l2"]);
    for (const k of keys) {
      expect(Object.keys(k).sort()).toEqual(["kid", "x"]);
      expect(Buffer.from(k.x, "base64url")).toHaveLength(32);
    }
  });
});

describe("kiểm cấu trúc claims (Codex P3 #2)", () => {
  it("chữ ký đúng nhưng claims thiếu trường hoặc sai kiểu → null", async () => {
    const { createPrivateKey, sign } = await import("node:crypto");
    const seed = Buffer.from(process.env.LICENSE_SIGNING_KEYS!.split(",")[1]!.split(":")[1]!, "base64");
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forge = (claimsObj: unknown) => {
      const input = `${enc({ alg: "EdDSA", kid: "l2", typ: "JWT" })}.${enc(claimsObj)}`;
      return `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`;
    };
    const keys = publicLicenseKeys();
    expect(await verifyLicense(forge({ v: 1, sub: "u", did: "d", courses: "tất cả", iat: 1, exp: 2, grace: 1 }), keys)).toBeNull();
    expect(await verifyLicense(forge({ v: 1, sub: "u", did: "d", courses: [], iat: 1, exp: "mãi", grace: 1 }), keys)).toBeNull();
    expect(await verifyLicense(forge({ v: 2, sub: "u", did: "d", courses: [{ id: "c", versionId: "v", until: "mãi" }], iat: 1, exp: 2, grace: 1 }), keys)).toBeNull();
    expect(await verifyLicense(forge({ v: 1, sub: "u", did: "d", courses: [{ id: "c", versionId: "v", until: 5 }], iat: 1, exp: 2, grace: 1 }), keys)).toBeNull();
    expect(await verifyLicense(forge({ v: 3, sub: "u", did: "d", courses: [], iat: 1, exp: 2, grace: 1 }), keys)).toBeNull();
    expect(await verifyLicense(forge({ v: 1, sub: "u", did: "d", courses: [{ id: "c", versionId: "v" }], iat: 1, exp: 2, grace: 1 }), keys)).not.toBeNull();
  });

  it("chuỗi khóa công khai nhúng lúc build", async () => {
    const { parsePublicKeyring } = await import("@/lib/offline/license-verify");
    expect(parsePublicKeyring("l1:abc,l2:def")).toEqual([{ kid: "l1", x: "abc" }, { kid: "l2", x: "def" }]);
    expect(parsePublicKeyring("")).toEqual([]);
    expect(parsePublicKeyring(undefined)).toEqual([]);
  });
});
