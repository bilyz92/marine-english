import { statfs } from "node:fs/promises";
import tls from "node:tls";
import { prisma, withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { ERROR_KINDS } from "@/modules/outbox/deliver";
import { enqueueOutbox } from "@/modules/outbox/outbox";

export type Alert = { type: string; detail: Record<string, unknown>; dedup?: string };
export type WatchDeps = {
  /** Tỷ lệ dùng (0–1) của ổ đĩa đầy nhất trong các thư mục dữ liệu. */
  diskUsage: () => Promise<number>;
  appHealthy: () => Promise<boolean>;
  /** Số ngày còn lại của chứng chỉ HTTPS; null nếu không đo được hoặc không dùng HTTPS. */
  certDaysLeft: () => Promise<number | null>;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BACKUP_JOB = "me.backup.daily";
const vnDay = (d: Date) => new Date(d.getTime() + 7 * HOUR).toISOString().slice(0, 10);

type RunRow = { job_name: string; first_run: Date; last_completed: Date | null; last_success: Date | null; last_skipped_unconfigured: boolean };

async function runSummary(): Promise<Map<string, RunRow>> {
  const rows = await prisma().$queryRaw<RunRow[]>`
    SELECT job_name, min(started_at) AS first_run,
           max(started_at) FILTER (WHERE status = 'success' OR stats ? 'skippedReason') AS last_completed,
           max(started_at) FILTER (WHERE status = 'success') AS last_success,
           (array_agg(stats ->> 'skippedReason' ORDER BY started_at DESC))[1] = 'not_configured' AS last_skipped_unconfigured
    FROM job_runs WHERE started_at > now() - interval '7 days' GROUP BY job_name`;
  return new Map(rows.map((r) => [r.job_name, r]));
}

/** Các điều kiện cần báo người vận hành tại thời điểm `now`. */
export async function watch(now: Date, deps: WatchDeps): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const usage = await deps.diskUsage();
  if (usage >= 0.85) alerts.push({ type: "disk_85", detail: { percent: Math.round(usage * 100) } });
  else if (usage >= 0.7) alerts.push({ type: "disk_70", detail: { percent: Math.round(usage * 100) } });
  if (!(await deps.appHealthy())) alerts.push({ type: "app_down", detail: {} });
  const days = await deps.certDaysLeft();
  if (days !== null && days < 14) alerts.push({ type: "cert_expiring", detail: { days } });

  const runs = await runSummary();
  // Sao lưu có cảnh báo riêng khi chưa cấu hình; ở đây chỉ báo khi đã chạy mà quá 26 giờ không có bản thành công.
  const backup = runs.get(BACKUP_JOB);
  if (backup && !backup.last_skipped_unconfigured) {
    const since = backup.last_success ?? backup.first_run;
    if (now.getTime() - since.getTime() > 26 * HOUR) {
      alerts.push({ type: "backup_stale", detail: { lastSuccess: backup.last_success }, dedup: `backup_stale:${vnDay(now)}` });
    }
  }
  // Job chưa từng chạy thì chưa tới hạn (lặp: chạy ngay lượt đầu; hằng ngày: chạy ngay sau giờ hẹn). Worker chết có tín hiệu riêng.
  const { JOBS, isDue } = await import("@/modules/jobs/definitions");
  for (const job of JOBS) {
    if (job.name === BACKUP_JOB) continue;
    const run = runs.get(job.name);
    if (!run) continue;
    if ("everyMs" in job.schedule) {
      const last = run.last_completed?.getTime() ?? run.first_run.getTime();
      // Một lượt có thể chạy tới hết thời gian cho phép (gửi thông báo khi Telegram chậm): không báo kẹt sớm hơn mức đó.
      const limit = Math.max(3 * job.schedule.everyMs, job.timeoutMs + 5 * MINUTE);
      if (now.getTime() - last > limit) alerts.push({ type: `job_stuck:${job.name}`, detail: { job: job.name } });
    } else if (run.last_completed && isDue(job, run.last_completed, new Date(now.getTime() - HOUR))) {
      alerts.push({ type: `job_missed:${job.name}`, detail: { job: job.name } });
    }
  }

  const [outbox] = await prisma().$queryRaw<{ stuck: number; dead: number }[]>`
    SELECT
      (SELECT count(*)::int FROM outbox_events WHERE status = 'pending' AND next_attempt_at < ${new Date(now.getTime() - 30 * MINUTE)}
         AND coalesce(last_error, '') <> 'not_configured') AS stuck,
      (SELECT count(*)::int FROM outbox_events WHERE status = 'dead' AND kind <> ALL(${[...ERROR_KINDS]}::text[])) AS dead`;
  if (outbox!.stuck > 0) alerts.push({ type: "outbox_stuck", detail: { count: outbox!.stuck } });
  // Báo lại mỗi khi số tin chết tăng, không lặp mỗi giờ.
  if (outbox!.dead > 0) alerts.push({ type: "outbox_dead", detail: { count: outbox!.dead }, dedup: `outbox_dead:${outbox!.dead}` });
  return alerts;
}

/** Mỗi điều kiện tối đa một tin mỗi giờ (trừ khi cảnh báo tự định khóa chống lặp). */
export async function enqueueAlerts(alerts: Alert[], now: Date): Promise<number> {
  const hour = now.toISOString().slice(0, 13);
  await withTx(async (tx) => {
    for (const alert of alerts) {
      await enqueueOutbox(tx, {
        dedupKey: `ops_alert:${alert.dedup ?? `${alert.type}:${hour}`}`,
        kind: "ops_alert",
        channel: "telegram",
        payload: { type: alert.type, ...alert.detail },
      });
    }
  });
  return alerts.length;
}

/** Dòng “running” mà lease đã hết hạn hoặc thuộc thế hệ khác: tiến trình đã chết, ghi failed. Chỉ đổi dòng còn running. */
export async function abandonStaleRuns(): Promise<number> {
  return prisma().$executeRaw`
    UPDATE job_runs r SET status = 'failed', error = 'abandoned', finished_at = now()
    WHERE r.status = 'running'
      AND NOT EXISTS (SELECT 1 FROM job_leases l WHERE l.job_name = r.job_name AND l.generation = r.generation AND l.expires_at >= now())`;
}

export function defaultWatchDeps(): WatchDeps {
  const e = env();
  return {
    async diskUsage() {
      let worst = 0;
      for (const dir of [e.MEDIA_ROOT, e.BACKUP_DIR].filter((d): d is string => Boolean(d))) {
        const s = await statfs(dir).catch(() => null);
        if (s && s.blocks > 0) worst = Math.max(worst, 1 - s.bavail / s.blocks);
      }
      return worst;
    },
    async appHealthy() {
      if (!e.APP_HEALTH_URL) return true;
      return fetch(e.APP_HEALTH_URL, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
    },
    certDaysLeft() {
      const origin = new URL(e.APP_ORIGIN);
      if (origin.protocol !== "https:") return Promise.resolve(null);
      return new Promise((resolve) => {
        // Chỉ đọc hạn chứng chỉ, không xác thực chuỗi (CA nội bộ khi chạy thử vẫn đo được).
        const socket = tls.connect({ host: origin.hostname, port: Number(origin.port) || 443, servername: origin.hostname, rejectUnauthorized: false, timeout: 10_000 }, () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          resolve(cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000) : null);
        });
        socket.on("error", () => resolve(null));
        socket.on("timeout", () => { socket.destroy(); resolve(null); });
      });
    },
  };
}
