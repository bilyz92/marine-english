import { pgAs } from "./pg";

/** Liệt kê "bảng.cột" có giá trị chứa needle trong schema test (quét mọi bảng, mọi cột). */
export async function findInDb(needle: string): Promise<string[]> {
  const client = await pgAs("migrator");
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1",
      [process.env.TEST_SCHEMA],
    );
    const hits: string[] = [];
    for (const { tablename } of tables) {
      const { rows } = await client.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`);
      for (const { row } of rows) {
        for (const [column, value] of Object.entries(row)) {
          if (value !== null && JSON.stringify(value).includes(needle)) hits.push(`${tablename}.${column}`);
        }
      }
    }
    return hits;
  } finally {
    await client.end();
  }
}
