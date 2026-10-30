import { readFileSync } from "node:fs";
import { importContent } from "@/worker/content-import";
import { pgAs } from "./pg";
import { sqlAsMigrator } from "./otp";

/** Nhập fixture 2 khóa (engine_cadet_tanker, engine_cadet_dry_cargo), trả id khóa theo slug. */
export async function seedContent(): Promise<Record<string, string>> {
  const client = await pgAs("migrator");
  try {
    await importContent(client, JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8")));
  } finally {
    await client.end();
  }
  const { rows } = await sqlAsMigrator(`SELECT id, slug FROM courses`);
  return Object.fromEntries(rows.map((r) => [r.slug, r.id]));
}

export async function publish(slug: string, priceVnd = 199_000) {
  await sqlAsMigrator(`UPDATE courses SET price_vnd = $2, status = 'published' WHERE slug = $1`, [slug, priceVnd]);
}
