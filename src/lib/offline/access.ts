// Quyền mở bài trên máy khi không hỏi được máy chủ. Mặc định từ chối: bài trả phí chỉ mở khi có giấy phép đã kiểm chữ ký,
// đúng người, đúng máy, có khóa học đó, và tại chính lúc mở bài vẫn còn hạn hoặc trong ân hạn. Bài học thử luôn mở.
import { licenseState } from "./license-state";
import type { LicenseClaims } from "./license-verify";

export type LicenseView = {
  state: "ok" | "grace" | "locked" | "none" | "unverifiable";
  claims: LicenseClaims | null;
  daysLeft: number | null;
  /** Mốc thời gian lớn nhất từng thấy trên máy (giây), chống chỉnh lùi đồng hồ. */
  maxSeen: number;
};

export function canOpenLesson(input: {
  isFreeTrial: boolean;
  courseId: string;
  /** Phiên bản khóa của manifest đang lưu trên máy: phải đúng phiên bản giấy phép cấp. */
  versionId: string;
  license: LicenseView | null;
  identity: { userId: string; deviceId: string };
  /** Giờ máy lúc mở bài (giây). */
  now: number;
}): boolean {
  if (input.isFreeTrial) return true;
  const { license, identity } = input;
  const c = license?.claims;
  // Đã khóa thì giữ khóa tới lần đồng bộ sau; trạng thái chưa xác minh được cũng từ chối.
  if (!license || !c || license.state === "none" || license.state === "unverifiable" || license.state === "locked") return false;
  if (c.sub !== identity.userId || c.did !== identity.deviceId) return false;
  if (!c.courses.some((x) => x.id === input.courseId && x.versionId === input.versionId)) return false;
  // Không tin trạng thái đã tính từ trước: tính lại theo giờ hiện tại.
  const { state } = licenseState({ exp: c.exp, grace: c.grace, deviceNow: input.now, maxSeen: license.maxSeen });
  return state === "ok" || state === "grace";
}
