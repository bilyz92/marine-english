import { prisma } from "@/lib/db";
import { deliverBatch, defaultSenders } from "@/modules/outbox/deliver";
import { reconcile, sepayApi } from "@/modules/ledger/reconcile";
import { expireOrders } from "@/modules/orders/orders";
import { cleanupSessionArtifacts } from "@/modules/sessions/sessions";
import { backup, backupAlerts, backupConfig } from "@/modules/ops/backup";
import { runTool } from "@/modules/ops/run-tool";
import { enqueueDailySummary } from "./daily-summary";
import { releaseStaleDevices } from "./devices-release";
import { withFence } from "./lease";
import type { JobDef } from "./runner";

/** Lặp theo khoảng cách, hoặc mỗi ngày vào giờ:phút theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7, không đổi giờ mùa). */
export type Schedule = { everyMs: number } | { dailyAt: string };
export type ScheduledJob = JobDef & { schedule: Schedule };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VN_OFFSET_MS = 7 * HOUR;

/** Thời điểm giờ:phút của ngày hiện tại theo giờ Việt Nam (có thể còn ở tương lai). */
function todaysSlot(dailyAt: string, now: Date): number {
  const [hours, minutes] = dailyAt.split(":").map(Number);
  const vnMidnight = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY) * DAY;
  return vnMidnight + hours! * HOUR + minutes! * MINUTE - VN_OFFSET_MS;
}

export function isDue(def: { schedule: Schedule }, lastRunAt: Date | null, now: Date): boolean {
  const { schedule } = def;
  if ("everyMs" in schedule) return !lastRunAt || now.getTime() - lastRunAt.getTime() >= schedule.everyMs;
  const slot = todaysSlot(schedule.dailyAt, now);
  return now.getTime() >= slot && (!lastRunAt || lastRunAt.getTime() < slot);
}

export const JOBS: ScheduledJob[] = [
  {
    name: "me.orders.expire",
    schedule: { everyMs: MINUTE },
    timeoutMs: MINUTE,
    run: async () => ({ expired: await expireOrders() }),
  },
  {
    name: "me.outbox.deliver",
    schedule: { everyMs: 10_000 },
    timeoutMs: 2 * MINUTE,
    run: async () => deliverBatch(defaultSenders()),
  },
  {
    name: "me.sessions.cleanup",
    schedule: { everyMs: HOUR },
    timeoutMs: 5 * MINUTE,
    run: async () => {
      await cleanupSessionArtifacts();
      return {};
    },
  },
  {
    name: "me.admin.invites.expire",
    schedule: { everyMs: HOUR },
    timeoutMs: MINUTE,
    run: async ({ lease }) => {
      const [row] = await withFence(lease, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT admin_expire_invites() AS n`);
      return { expired: row!.n };
    },
  },
  {
    name: "me.summary.daily",
    schedule: { dailyAt: "21:00" },
    timeoutMs: MINUTE,
    run: async ({ lease }) => enqueueDailySummary(lease, new Date()),
  },
  {
    name: "me.devices.release",
    schedule: { dailyAt: "03:30" },
    timeoutMs: 10 * MINUTE,
    run: async ({ lease, signal }) => releaseStaleDevices(lease, signal),
  },
  {
    name: "me.sepay.reconcile",
    schedule: { everyMs: HOUR },
    timeoutMs: 30 * MINUTE,
    run: async ({ lease, signal }) => {
      const api = sepayApi();
      return api ? reconcile(api, lease, signal) : { skippedReason: "not_configured" };
    },
  },
  {
    name: "me.backup.daily",
    schedule: { dailyAt: "02:30" },
    timeoutMs: 2 * HOUR,
    run: async ({ lease, signal }) => {
      const config = backupConfig();
      if (!config) {
        // Không sao lưu là lỗi vận hành ở production, nên vẫn báo dù job chỉ ghi skipped.
        if (process.env.NODE_ENV === "production") await backupAlerts({ notConfigured: true });
        return { skippedReason: "not_configured" };
      }
      const stats = await backup({ config, run: runTool, lease, signal, now: new Date() });
      if (!stats.offsite) await backupAlerts({ offsite: false });
      return stats;
    },
  },
  {
    name: "me.jobs.prune",
    schedule: { dailyAt: "04:00" },
    timeoutMs: 5 * MINUTE,
    run: async () => {
      const [row] = await prisma().$queryRaw<{ n: number }[]>`SELECT prune_job_runs() AS n`;
      return { deleted: row!.n };
    },
  },
];
