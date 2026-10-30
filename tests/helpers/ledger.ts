import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { BankReport } from "@/modules/ledger/ingest";
import { createOrder } from "@/modules/orders/orders";
import { publish, seedContent } from "./content";
import { testLearner, type TestLearner } from "./learner-ctx";

export const SLUG = "engine_cadet_tanker";
export const PRICE = 199_000;

export async function paidCourseSetup(): Promise<{ learner: TestLearner; code: string; createdAt: Date; expiresAt: Date; orderId: string }> {
  await seedContent();
  await publish(SLUG, PRICE);
  const learner = await testLearner();
  const r = await createOrder(learner, SLUG);
  if (r.kind !== "created") throw new Error(r.kind);
  const order = await prisma().order.findUniqueOrThrow({ where: { code: r.order.code } });
  return { learner, code: order.code, createdAt: order.createdAt, expiresAt: order.expiresAt, orderId: order.id };
}

export function report(patch: Partial<BankReport> = {}): BankReport {
  return {
    source: "sepay_webhook",
    bankCode: "VCB",
    accountNo: "0123456789",
    bankRef: `FT${randomBytes(4).toString("hex").toUpperCase()}`,
    amountVnd: PRICE,
    direction: "in",
    currency: "VND",
    content: "",
    bankTime: new Date(),
    raw: { test: true },
    ...patch,
  };
}

export const counts = async () => ({
  ledger: await prisma().bankTransaction.count(),
  allocations: await prisma().paymentAllocation.count(),
  enrollments: await prisma().enrollment.count(),
  outbox: await prisma().outboxEvent.count(),
  observations: await prisma().bankTransactionObservation.count(),
});
