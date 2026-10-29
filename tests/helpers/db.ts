import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

// Mỗi tệp test integration chạy trên một schema Postgres riêng, dựng từ các migration.
const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

export function newSchemaName(): string {
  return `test_${randomBytes(6).toString("hex")}`;
}

export function withSearchPath(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  u.searchParams.set("schema", schema);
  return u.toString();
}

async function migratorClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
  await client.connect();
  return client;
}

export async function createSchemaWithMigrations(schema: string): Promise<void> {
  const client = await migratorClient();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    if (existsSync(MIGRATIONS_DIR)) {
      const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const dir of dirs) {
        await client.query(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
      }
    }
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO me_app, me_other`);
  } finally {
    await client.end();
  }
}

export async function dropSchema(schema: string): Promise<void> {
  const client = await migratorClient();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
  }
}

/** Xóa sạch dữ liệu mọi bảng của schema hiện tại; trả về số bảng còn dòng (phải là 0). */
export async function resetDbForCurrentSchema(): Promise<number> {
  const schema = process.env.TEST_SCHEMA;
  if (!schema) throw new Error("TEST_SCHEMA chưa được đặt");
  const client = await migratorClient();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1",
      [schema],
    );
    if (rows.length === 0) return 0;
    const list = rows.map((r) => `"${schema}"."${r.tablename}"`).join(", ");
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    let nonEmpty = 0;
    for (const r of rows) {
      const res = await client.query(`SELECT 1 FROM "${schema}"."${r.tablename}" LIMIT 1`);
      if (res.rowCount) nonEmpty += 1;
    }
    return nonEmpty;
  } finally {
    await client.end();
  }
}
