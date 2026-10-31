import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { JOBS } from "@/modules/jobs/definitions";
import { acquireLease, LeaseLostError } from "@/modules/jobs/lease";
import { runJob } from "@/modules/jobs/runner";
import { releaseStaleDevices } from "@/modules/jobs/devices-release";
import { syncEvents } from "@/modules/learn/sync";
import { validateSession } from "@/modules/sessions/sessions";
import { testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

const job = JOBS.find((j) => j.name === "me.devices.release")!;
const device = (id: string) => prisma().device.findUniqueOrThrow({ where: { id } });
const setLastSeen = (id: string, age: string) =>
  sqlAsMigrator(`UPDATE devices SET last_seen_at = now() - $2::interval WHERE id = $1`, [id, age]);

describe("giải phóng thiết bị quá hạn", () => {
  it("lịch 03:30 giờ VN", () => {
    expect(job.schedule).toEqual({ dailyAt: "03:30" });
  });

  it("36 ngày không đụng (học viên còn trong hạn học offline); 37 ngày + 1 giây → thu hồi, phiên hết hiệu lực", async () => {
    const fresh = await testLearner("Con han");
    const stale = await testLearner("Qua han");
    await setLastSeen(fresh.deviceId, "36 days");
    await setLastSeen(stale.deviceId, "37 days 1 second");
    expect(await runJob(job, "w1")).toMatchObject({ status: "success", stats: { released: 1 } });
    expect((await device(stale.deviceId)).revokedAt).not.toBeNull();
    expect(await validateSession("learner", stale.token)).toBeNull();
    expect((await device(fresh.deviceId)).revokedAt).toBeNull();
    expect(await validateSession("learner", fresh.token)).not.toBeNull();
  });

  it("máy chưa từng dùng tính theo ngày đăng ký", async () => {
    const l = await testLearner("Chua dung");
    await sqlAsMigrator(`UPDATE devices SET last_seen_at = NULL, registered_at = now() - interval '38 days' WHERE id = $1`, [l.deviceId]);
    expect(await runJob(job, "w1")).toMatchObject({ stats: { released: 1 } });
  });

  it("máy đã thu hồi không bị ghi lại", async () => {
    const l = await testLearner("Da go");
    await sqlAsMigrator(`UPDATE devices SET revoked_at = now() - interval '1 day', last_seen_at = now() - interval '40 days' WHERE id = $1`, [l.deviceId]);
    const before = (await device(l.deviceId)).revokedAt;
    expect(await runJob(job, "w1")).toMatchObject({ stats: { released: 0 } });
    expect((await device(l.deviceId)).revokedAt).toEqual(before);
  });

  it("máy đăng nhập đã lâu nhưng vẫn dùng đều → không bị thu hồi", async () => {
    const l = await testLearner("Van dung");
    await setLastSeen(l.deviceId, "40 days");
    await sqlAsMigrator(`UPDATE learner_sessions SET last_seen_at = now() - interval '6 minutes' WHERE device_id = $1`, [l.deviceId]);
    expect(await validateSession("learner", l.token)).not.toBeNull();
    expect(await runJob(job, "w1")).toMatchObject({ stats: { released: 0 } });
    expect((await device(l.deviceId)).revokedAt).toBeNull();
  });

  it("đồng bộ cũng tính là dùng máy", async () => {
    const l = await testLearner("Dong bo");
    await setLastSeen(l.deviceId, "40 days");
    await syncEvents(l, { events: [] });
    expect(await runJob(job, "w1")).toMatchObject({ stats: { released: 0 } });
  });

  it("mất lease → không thu hồi", async () => {
    const l = await testLearner("Mat lease");
    await setLastSeen(l.deviceId, "40 days");
    const stale = (await acquireLease(job.name, "cu"))!;
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = $1`, [job.name]);
    await acquireLease(job.name, "moi");
    await expect(releaseStaleDevices(stale, new AbortController().signal)).rejects.toBeInstanceOf(LeaseLostError);
    expect((await device(l.deviceId)).revokedAt).toBeNull();
  });

  it("job bị hủy thì dừng trước máy tiếp theo", async () => {
    const l = await testLearner("Huy");
    await setLastSeen(l.deviceId, "40 days");
    const lease = (await acquireLease(job.name, "w1"))!;
    const controller = new AbortController();
    controller.abort();
    expect(await releaseStaleDevices(lease, controller.signal)).toEqual({ released: 0 });
    expect((await device(l.deviceId)).revokedAt).toBeNull();
  });
});
