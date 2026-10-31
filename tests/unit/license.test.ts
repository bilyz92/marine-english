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
