import { describe, expect, it } from "vitest";
import { canOpenLesson } from "@/lib/offline/access";

const claims = { v: 1, sub: "u1", did: "d1", courses: [{ id: "c1", versionId: "v1" }], iat: 0, exp: 100, grace: 50 };
const who = { userId: "u1", deviceId: "d1" };
const ok = { state: "ok" as const, claims, daysLeft: 1, maxSeen: 10 };
const NOW = 10;

describe("quyền mở bài khi offline (Codex P3 #1)", () => {
  it("bài học thử luôn mở", () => {
    expect(canOpenLesson({ isFreeTrial: true, courseId: "c1", versionId: "v1", license: null, identity: who, now: NOW })).toBe(true);
  });
  it("bài trả phí: chỉ khi giấy phép ok/grace, đúng người, đúng máy, có khóa", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: ok, identity: who, now: NOW })).toBe(true);
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: ok, identity: who, now: 120 })).toBe(true);
  });
  it.each([
    ["đang tải", null],
    ["không có giấy phép", { state: "none" as const, claims: null, daysLeft: null, maxSeen: 0 }],
    ["quá hạn", { ...ok, state: "locked" as const }],
    ["không chứa khóa", { ...ok, claims: { ...claims, courses: [{ id: "c2", versionId: "v" }] } }],
    ["người khác", { ...ok, claims: { ...claims, sub: "u2" } }],
    ["máy khác", { ...ok, claims: { ...claims, did: "d2" } }],
    ["không kiểm được chữ ký", { state: "unverifiable" as const, claims: null, daysLeft: null, maxSeen: 0 }],
  ])("bài trả phí bị chặn: %s", (_name, license) => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license, identity: who, now: NOW })).toBe(false);
  });
});


describe("hạn giấy phép tính lại lúc mở bài (Codex P3 vòng 2)", () => {
  it("trạng thái đã tính là ok nhưng giờ hiện tại quá exp + grace → chặn", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: ok, identity: who, now: 150 })).toBe(false);
  });
  it("giờ máy bị chỉnh lùi: dùng mốc lớn nhất đã thấy", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: { ...ok, maxSeen: 160 }, identity: who, now: 5 })).toBe(false);
  });
});


describe("phiên bản nội dung (Codex P3 vòng 3)", () => {
  it("manifest đang lưu là phiên bản cũ, giấy phép cấp cho phiên bản mới → chặn tới khi tải manifest mới", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v0", license: ok, identity: who, now: NOW })).toBe(false);
  });
});

describe("khóa mở tạm (chủ chưa duyệt): hạn riêng 3 ngày, không ân hạn (chủ chọn 03/11/2026)", () => {
  const prov = { ...ok, claims: { ...claims, courses: [{ id: "c1", versionId: "v1", until: 40 }] } };
  it("trước hạn riêng → mở; tới hạn riêng → chặn dù giấy phép còn hạn", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: prov, identity: who, now: 39 })).toBe(true);
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: prov, identity: who, now: 40 })).toBe(false);
  });
  it("chỉnh lùi đồng hồ không kéo dài hạn riêng", () => {
    expect(canOpenLesson({ isFreeTrial: false, courseId: "c1", versionId: "v1", license: { ...prov, maxSeen: 45 }, identity: who, now: 20 })).toBe(false);
  });
});
