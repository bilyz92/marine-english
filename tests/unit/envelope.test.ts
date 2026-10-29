import { afterEach, describe, expect, it, vi } from "vitest";

const aad = { realm: "learner" as const, sessionId: "s-a", newTokenHash: "h-a" };

async function load() {
  return import("@/modules/sessions/envelope");
}

function tamper(envelope: string, index: number): string {
  const parts = envelope.split(".");
  const bytes = Buffer.from(parts[index]!, "base64url");
  bytes[0] = bytes[0]! ^ 0xff;
  parts[index] = bytes.toString("base64url");
  return parts.join(".");
}

describe("phong bì next_token_enc", () => {
  const originalCurrent = process.env.SESSION_ENC_KEY_CURRENT;
  afterEach(() => {
    process.env.SESSION_ENC_KEY_CURRENT = originalCurrent;
    vi.resetModules();
  });

  it("đúng định dạng v1.<kid>.<nonce>.<ciphertext>.<tag> và mở lại được", async () => {
    const { sealNextToken, openNextToken } = await load();
    const envelope = sealNextToken({ ...aad, token: "tok-1" });
    const [v, kid, nonce, ct, tag] = envelope.split(".");
    expect(v).toBe("v1");
    expect(kid).toBe("k1");
    expect(Buffer.from(nonce!, "base64url")).toHaveLength(12);
    expect(ct!.length).toBeGreaterThan(0);
    expect(Buffer.from(tag!, "base64url")).toHaveLength(16);
    expect(envelope).not.toContain("tok-1");
    expect(openNextToken(envelope, aad)).toBe("tok-1");
  });

  it("nonce mới mỗi lần", async () => {
    const { sealNextToken } = await load();
    expect(sealNextToken({ ...aad, token: "t" })).not.toBe(sealNextToken({ ...aad, token: "t" }));
  });

  it("sửa 1 byte ciphertext, nonce hoặc tag → null", async () => {
    const { sealNextToken, openNextToken } = await load();
    const envelope = sealNextToken({ ...aad, token: "tok-1" });
    for (const index of [2, 3, 4]) expect(openNextToken(tamper(envelope, index), aad)).toBeNull();
  });

  it("kid lạ, sai phiên bản hoặc sai định dạng → null", async () => {
    const { sealNextToken, openNextToken } = await load();
    const parts = sealNextToken({ ...aad, token: "tok-1" }).split(".");
    expect(openNextToken(["v1", "k9", ...parts.slice(2)].join("."), aad)).toBeNull();
    expect(openNextToken(["v2", ...parts.slice(1)].join("."), aad)).toBeNull();
    expect(openNextToken("rác", aad)).toBeNull();
  });

  it("phong bì phiên A mở với AAD phiên B hoặc khu vực khác → null", async () => {
    const { sealNextToken, openNextToken } = await load();
    const envelope = sealNextToken({ ...aad, token: "tok-1" });
    expect(openNextToken(envelope, { ...aad, sessionId: "s-b" })).toBeNull();
    expect(openNextToken(envelope, { ...aad, newTokenHash: "h-b" })).toBeNull();
    expect(openNextToken(envelope, { ...aad, realm: "admin" })).toBeNull();
  });

  it("đổi khóa hiện hành sang k2 (giữ k1) → vẫn mở phong bì cũ, phong bì mới dùng k2", async () => {
    const before = await load();
    const envelope = before.sealNextToken({ ...aad, token: "tok-1" });
    process.env.SESSION_ENC_KEY_CURRENT = "k2";
    vi.resetModules();
    const after = await load();
    expect(after.openNextToken(envelope, aad)).toBe("tok-1");
    expect(after.sealNextToken({ ...aad, token: "x" }).split(".")[1]).toBe("k2");
  });
});
