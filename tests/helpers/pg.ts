import { Client } from "pg";
import { withSearchPath } from "./db";

type Role = "migrator" | "app" | "other";

const URL_BY_ROLE: Record<Role, () => string | undefined> = {
  migrator: () => process.env.MIGRATOR_DATABASE_URL,
  app: () => process.env.DATABASE_URL,
  other: () => process.env.ME_OTHER_DATABASE_URL,
};

/** Kết nối pg thô bằng một vai trò, search_path trỏ về schema của tệp test. */
export async function pgAs(role: Role): Promise<Client> {
  const base = URL_BY_ROLE[role]();
  if (!base) throw new Error(`thiếu URL cho vai trò ${role}`);
  const client = new Client({ connectionString: withSearchPath(base, process.env.TEST_SCHEMA!) });
  await client.connect();
  return client;
}

/** Chạy câu lệnh và trả mã lỗi Postgres (hoặc null nếu thành công). */
export async function errCode(client: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}
