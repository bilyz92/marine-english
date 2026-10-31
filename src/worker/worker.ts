// Tiến trình nền chạy cạnh app (cùng Docker Compose): pnpm worker. Không mở cổng HTTP; “chạy ngay” đi qua bảng job_requests.
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { disconnectDb } from "@/lib/db";
import { JOBS } from "@/modules/jobs/definitions";
import { createScheduler } from "@/modules/jobs/scheduler";
import { tickStuck } from "./watchdog";

const TICK_MS = 5_000;
// Healthcheck của container đọc thời điểm sửa tệp này.
const HEARTBEAT_FILE = "/tmp/worker-heartbeat";
const SHUTDOWN_GRACE_MS = 25_000;
// Sau khi hủy, runner chờ job dọn dẹp tối đa 30 giây; 25 + 30 vẫn dưới stop_grace_period 60 giây.
const AFTER_ABORT_MS = 30_000;

const log = (fields: Record<string, unknown>) => console.log(JSON.stringify({ at: "worker", ...fields }));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

const abort = new AbortController();
const scheduler = createScheduler(JOBS, `${hostname()}:${process.pid}`, { signal: abort.signal });

let stopping = false;
let tickStartedAt: number | null = null;
const timer = setInterval(() => {
  if (tickStartedAt === null) tickStartedAt = Date.now();
  scheduler.tick().then(() => {
    tickStartedAt = null;
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  }, (error: unknown) => {
    tickStartedAt = null;
    log({ error: error instanceof Error ? error.message : String(error) });
  });
}, TICK_MS);
// Treo mà event loop còn chạy (ví dụ một truy vấn không bao giờ trả lời): thoát để Docker khởi động lại.
setInterval(() => {
  if (!stopping && tickStuck(tickStartedAt, Date.now())) {
    log({ error: "tick_stuck", exiting: true });
    process.exit(1);
  }
}, 30_000).unref();

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  scheduler.stop();
  log({ stopping: signal });
  // Chờ job đang chạy xong; quá hạn thì hủy để runner ghi nhật ký và nhả lease trước khi thoát.
  await Promise.race([scheduler.drain(), sleep(SHUTDOWN_GRACE_MS)]);
  abort.abort();
  await Promise.race([scheduler.drain(), sleep(AFTER_ABORT_MS)]);
  await disconnectDb();
  log({ stopped: true });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
log({ started: true, jobs: JOBS.map((job) => job.name) });
