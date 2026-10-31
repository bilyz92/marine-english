import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { JOBS } from "@/modules/jobs/definitions";
import { acquireLease, LeaseLostError, type Lease } from "@/modules/jobs/lease";
import { runJob } from "@/modules/jobs/runner";
import { ingest } from "@/modules/ledger/ingest";
import { reconcile, type SepayApi } from "@/modules/ledger/reconcile";
import { counts, paidCourseSetup, PRICE, report } from "../helpers/ledger";
import { sqlAsMigrator } from "../helpers/otp";

let seq = 0;
function item(patch: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `api-${seq}`, gateway: "VCB", accountNumber: "0123456789", transferType: "in", transferAmount: 50_000,
    content: "khong co ma", referenceCode: `REF${seq}`, transactionDate: "2026-10-31 10:00:00", ...patch,
  };
}
const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

function fakeApi(pages: unknown[][], failAtPage?: number) {
  const calls: { from: Date; cursor?: string }[] = [];
  const api: SepayApi = {
    async listTransactions(input) {
      calls.push(input);
      const index = input.cursor ? Number(input.cursor) : 0;
      if (index === failAtPage) throw new Error("sepay_503");
      return { items: pages[index] ?? [], nextCursor: index + 1 < pages.length ? String(index + 1) : undefined };
    },
  };
  return { api, calls };
}
const newLease = async () => (await acquireLease("me.sepay.reconcile", "w1"))!;
const cursor = () => prisma().reconciliationCursor.findUnique({ where: { provider_bankCode_accountNo: { provider: "sepay", bankCode: "VCB", accountNo: "0123456789" } } });
const signal = () => new AbortController().signal;

describe("đối soát SePay", () => {
  it("hai trang → ingest hết, con trỏ cập nhật; lần sau đọc lùi 2 giờ từ con trỏ", async () => {
    const { api, calls } = fakeApi([[item(), item()], [item()]]);
    const before = Date.now();
    const result = await reconcile(api, await newLease(), signal());
    expect(result).toMatchObject({ pages: 2, ingested: 3, outcomes: { queued: 3 } });
    expect((await counts()).ledger).toBe(3);
    const saved = (await cursor())!;
    expect(saved.lastCompleteBankTime.getTime()).toBeGreaterThanOrEqual(before);
    expect(calls[0]!.from.getTime()).toBeLessThanOrEqual(before - 2 * 3_600_000 + 5_000);
    expect(calls[1]).toMatchObject({ cursor: "1" });

    const next = fakeApi([[]]);
    await reconcile(next.api, await currentLease(), signal());
    expect(next.calls[0]!.from.getTime()).toBe(saved.lastCompleteBankTime.getTime() - 2 * 3_600_000);
  });

  it("lỗi ở trang 2 → con trỏ không đổi; đọc lại không tạo trùng", async () => {
    const pages = [[item(), item()], [item()]];
    const failing = fakeApi(pages, 1);
    await expect(reconcile(failing.api, await newLease(), signal())).rejects.toThrow("sepay_503");
    expect(await cursor()).toBeNull();
    expect((await counts()).ledger).toBe(2);

    const ok = fakeApi(pages);
    const result = await reconcile(ok.api, await currentLease(), signal());
    expect(result.outcomes).toMatchObject({ duplicate_event: 2, queued: 1 });
    expect((await counts()).ledger).toBe(3);
    expect(await cursor()).not.toBeNull();
  });

  it("giao dịch webhook bỏ sót được xác nhận qua đối soát, mở quyền học", async () => {
    const s = await paidCourseSetup();
    const { api } = fakeApi([[item({ transferAmount: PRICE, content: s.code, transactionDate: vnTime(new Date(s.createdAt.getTime() + 60_000)) })]]);
    const result = await reconcile(api, await newLease(), signal());
    expect(result.outcomes).toMatchObject({ confirmed: 1 });
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
    expect(await prisma().enrollment.count({ where: { orderId: s.orderId } })).toBe(1);
  });

  it("giao dịch webhook đã ghi → đối soát không tạo dòng sổ thứ hai", async () => {
    const shared = item();
    await ingest(report({ bankRef: shared.referenceCode, amountVnd: shared.transferAmount, bankTime: new Date("2026-10-31T10:00:00+07:00"), content: shared.content }));
    await reconcile(fakeApi([[shared]]).api, await newLease(), signal());
    expect((await counts()).ledger).toBe(1);
  });

  it("một dòng sai định dạng → báo lỗi, con trỏ không đổi (không lẳng lặng bỏ tiền)", async () => {
    const { api } = fakeApi([[{ id: 1, transferAmount: "x" }]]);
    await expect(reconcile(api, await newLease(), signal())).rejects.toThrow("sepay_item_malformed");
    expect(await cursor()).toBeNull();
  });

  it("mất lease → không cập nhật con trỏ", async () => {
    const stale = await newLease();
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second'`);
    await acquireLease("me.sepay.reconcile", "moi");
    await expect(reconcile(fakeApi([[item()]]).api, stale, signal())).rejects.toBeInstanceOf(LeaseLostError);
    expect(await cursor()).toBeNull();
    expect(await counts()).toMatchObject({ ledger: 0, allocations: 0, enrollments: 0, outbox: 0, observations: 0 });
  });

  it("bị hủy giữa chừng → dừng, không cập nhật con trỏ", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(reconcile(fakeApi([[item()]]).api, await newLease(), controller.signal)).rejects.toThrow();
    expect(await cursor()).toBeNull();
    expect((await counts()).ledger).toBe(0);
  });

  it("job chưa có API (chờ G4) → ghi skipped not_configured, không cảnh báo", async () => {
    const job = JOBS.find((j) => j.name === "me.sepay.reconcile")!;
    expect(job.schedule).toEqual({ everyMs: 3_600_000 });
    expect(await runJob(job, "w1")).toMatchObject({ status: "skipped" });
    expect(await prisma().jobRun.findFirstOrThrow({ where: { jobName: job.name } })).toMatchObject({ status: "skipped", stats: { skippedReason: "not_configured" } });
    expect(await prisma().outboxEvent.count({ where: { kind: "job_failed" } })).toBe(0);
  });
});

// Lease đang giữ của job: lấy lại sau khi cho hết hạn (giả lập lần chạy sau).
async function currentLease(): Promise<Lease> {
  await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second'`);
  return newLease();
}
