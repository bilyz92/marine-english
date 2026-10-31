/** Header CSRF cho request ghi của học viên, đọc từ cookie không httpOnly. */
export function learnerCsrfHeader(): Record<string, string> {
  const token = document.cookie.split("; ").find((c) => c.startsWith("__Host-me_csrf_learner="))?.split("=")[1] ?? "";
  return { "x-csrf-token": token };
}
