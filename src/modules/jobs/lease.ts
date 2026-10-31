import { prisma, withTx, type Tx, type TxOptions } from "@/lib/db";

export type Lease = { job: string; token: string; generation: bigint };

const LEASE_SECONDS = 120;

export class LeaseLostError extends Error {
  constructor(job: string) {
    super(`lease_lost:${job}`);
    this.name = "LeaseLostError";
  }
}

/** Lấy lease cho job nếu chưa ai giữ hoặc lease cũ đã hết hạn; mỗi lần lấy tăng generation. */
export async function acquireLease(job: string, holder: string): Promise<Lease | null> {
  const rows = await prisma().$queryRaw<{ token: string; generation: bigint }[]>`
    INSERT INTO job_leases (job_name, token, generation, holder, expires_at)
    VALUES (${job}, gen_random_uuid(), 1, ${holder}, now() + make_interval(secs => ${LEASE_SECONDS}))
    ON CONFLICT (job_name) DO UPDATE
      SET token = gen_random_uuid(), generation = job_leases.generation + 1,
          holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
      WHERE job_leases.expires_at < now()
    RETURNING token::text AS token, generation`;
  return rows[0] ? { job, token: rows[0].token, generation: rows[0].generation } : null;
}

/** Gia hạn lease; false nghĩa là đã mất (hết hạn hoặc bị người khác lấy). */
export async function heartbeat(lease: Lease): Promise<boolean> {
  const n = await prisma().$executeRaw`
    UPDATE job_leases SET expires_at = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE job_name = ${lease.job} AND token = ${lease.token}::uuid AND generation = ${lease.generation}
      AND expires_at >= now()`;
  return n === 1;
}

export async function releaseLease(lease: Lease): Promise<void> {
  await prisma().$executeRaw`
    UPDATE job_leases SET expires_at = now() - interval '1 second'
    WHERE job_name = ${lease.job} AND token = ${lease.token}::uuid AND generation = ${lease.generation}`;
}

/** Chạy fn trong transaction đang khóa dòng lease; lease không còn hiệu lực thì không ghi gì và ném LeaseLostError. */
export async function withFence<T>(lease: Lease, fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
  return withTx(async (tx) => {
    const rows = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT (token = ${lease.token}::uuid AND generation = ${lease.generation} AND expires_at >= now()) AS ok
      FROM job_leases WHERE job_name = ${lease.job} FOR UPDATE`;
    if (!rows[0]?.ok) throw new LeaseLostError(lease.job);
    return fn(tx);
  }, opts);
}
