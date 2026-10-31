// Quyền mở bài trên máy khi không hỏi được máy chủ. Mặc định từ chối: bài trả phí chỉ mở khi có giấy phép đã kiểm chữ ký,
// đúng người, đúng máy, có khóa học đó và còn hạn hoặc trong ân hạn. Bài học thử luôn mở.
import type { LicenseClaims } from "./license-verify";

export type LicenseView = {
  state: "ok" | "grace" | "locked" | "none" | "unverifiable";
  claims: LicenseClaims | null;
  daysLeft: number | null;
};

export function canOpenLesson(input: {
  isFreeTrial: boolean;
  courseId: string;
  license: LicenseView | null;
  identity: { userId: string; deviceId: string };
}): boolean {
  if (input.isFreeTrial) return true;
  const { license, identity } = input;
  if (!license || (license.state !== "ok" && license.state !== "grace") || !license.claims) return false;
  const c = license.claims;
  return c.sub === identity.userId && c.did === identity.deviceId && c.courses.some((x) => x.id === input.courseId);
}
