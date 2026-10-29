import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

let client: PrismaClient | undefined;

export function prisma(): PrismaClient {
  if (!client) {
    const url = env().DATABASE_URL;
    // Prisma ghi rõ tên schema vào truy vấn; lấy từ tham số ?schema= của URL (mặc định public).
    const schema = new URL(url).searchParams.get("schema") ?? undefined;
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

const RETRYABLE = new Set(["40P01", "40001", "55P03"]);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown } };
  for (const c of [e?.code, e?.meta?.code, e?.cause?.code]) {
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}

export type TxOptions = {
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  retries?: number;
  /** Mốc Date.now() cuối cùng còn được thử lại. */
  deadlineAt?: number;
};

/** Chạy fn trong một transaction có giới hạn khóa/câu lệnh; thử lại khi deadlock hoặc hết thời gian chờ khóa. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const { lockTimeoutMs = 3000, statementTimeoutMs = 10_000, retries = 3, deadlineAt } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.floor(lockTimeoutMs)}`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.floor(statementTimeoutMs)}`);
        return fn(tx);
      });
    } catch (error) {
      const code = pgCode(error);
      const outOfTime = deadlineAt !== undefined && Date.now() >= deadlineAt;
      if (!code || !RETRYABLE.has(code) || attempt >= retries || outOfTime) throw error;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
    }
  }
}
