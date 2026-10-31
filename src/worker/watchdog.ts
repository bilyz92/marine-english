const STUCK_MS = 5 * 60_000;

/** Một lượt tick (chọn và khởi động job) chạy quá 5 phút nghĩa là worker treo: thoát để Docker khởi động lại. */
export function tickStuck(tickStartedAt: number | null, now: number): boolean {
  return tickStartedAt !== null && now - tickStartedAt > STUCK_MS;
}
