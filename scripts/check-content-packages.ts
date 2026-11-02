// Kiểm tay các gói học liệu gốc (không commit vì nặng): node --import ./src/worker/alias-loader.mjs scripts/check-content-packages.ts docs/*.zip
import { readFileSync } from "node:fs";
import { readPackage } from "../src/modules/content/package.ts";

for (const file of process.argv.slice(2)) {
  const before = process.memoryUsage().rss;
  const started = Date.now();
  const pkg = readPackage(readFileSync(file), file);
  const sets = pkg.datasets.map((d) => {
    const x = d as { dataset_id: string; content_version: string; lessons: unknown[]; courses: { id: string; lesson_ids: unknown[] }[] };
    return `${x.dataset_id}@${x.content_version}: ${x.lessons.length} bài, ${x.courses.map((c) => `${c.id}=${c.lesson_ids.length}`).join(" ")}`;
  });
  console.log(`${file}: ${Date.now() - started} ms, RSS +${Math.round((process.memoryUsage().rss - before) / 1048576)} MB, bỏ qua ${pkg.skipped.length} mục`);
  for (const s of sets) console.log(`  ${s}`);
}
