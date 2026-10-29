import { afterAll, beforeEach } from "vitest";
import { applyTestEnv } from "./test-env";
import { createSchemaWithMigrations, dropSchema, newSchemaName, resetDbForCurrentSchema, withSearchPath } from "./db";

applyTestEnv();
const schema = newSchemaName();
process.env.TEST_SCHEMA = schema;
await createSchemaWithMigrations(schema);
process.env.DATABASE_URL = withSearchPath(process.env.DATABASE_URL!, schema);
process.env.ME_OTHER_DATABASE_URL = withSearchPath(process.env.ME_OTHER_DATABASE_URL!, schema);

beforeEach(async () => {
  const leftover = await resetDbForCurrentSchema();
  if (leftover !== 0) throw new Error(`Còn ${leftover} bảng chưa sạch dữ liệu`);
});

afterAll(async () => {
  const { disconnectDb } = await import("@/lib/db");
  await disconnectDb();
  await dropSchema(schema);
});
