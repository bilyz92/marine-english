// Tiến trình nền chạy cạnh app (cùng Docker Compose): pnpm worker. Không mở cổng HTTP; “chạy ngay” đi qua bảng job_requests.
import { hostname } from "node:os";
import { disconnectDb } from "@/lib/db";
import { JOBS } from "@/modules/jobs/definitions";
import { createScheduler } from "@/modules/jobs/scheduler";

const TICK_MS = 5_000;
const SHUTDOWN_GRACE_MS = 25_000;
const AFTER_ABORT_MS = 3_000;

const log = (fields: Record<string, unknown>) => console.log(JSON.stringify({ at: "worker", ...fields }));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

const abort = new AbortController();
const scheduler = createScheduler(JOBS, `${hostname()}:${process.pid}`, { signal: abort.signal });

let stopping = false;
const timer = setInterval(() => {
  if (stopping) return;
  scheduler.tick().catch((error: unknown) => {
    log({ error: error instanceof Error ? error.message : String(error) });
  });
}, TICK_MS);

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
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
