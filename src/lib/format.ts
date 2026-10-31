/** 249000 → "249.000đ" (spec mục 3). */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")}đ`;
}
