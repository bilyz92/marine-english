// Hiệu lực giấy phép trên máy (hàm thuần, giây Unix). t = max(giờ máy, mốc lớn nhất đã lưu) để chỉnh lùi đồng hồ không làm giấy phép sống lại.

export type LicenseState = "ok" | "grace" | "locked";

export function licenseState(input: { exp: number; grace: number; deviceNow: number; maxSeen: number }): { state: LicenseState; maxSeen: number } {
  const t = Math.max(input.deviceNow, input.maxSeen);
  const state: LicenseState = t < input.exp ? "ok" : t < input.exp + input.grace ? "grace" : "locked";
  return { state, maxSeen: t };
}
