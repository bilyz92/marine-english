// Chụp và kiểm từng trang: node tests/e2e-ui/shots.mjs <địa chỉ gốc> <thư mục ảnh> [đường dẫn…]
import { mkdirSync } from "node:fs";
import { openBrowser, PAGE_CHECKS } from "./lib.mjs";

const [base, out, ...paths] = process.argv.slice(2);
const PATHS = paths.length ? paths : ["/", "/khoa-hoc", "/gioi-thieu", "/chinh-sach", "/chinh-sach?tab=hoan-tien", "/lien-he", "/dang-nhap", "/quan-tri/dang-nhap"];
mkdirSync(out, { recursive: true });
const browser = await openBrowser();
let failed = 0;
try {
  for (const path of PATHS) {
    for (const width of [360, 390, 1280]) {
      await browser.width(width);
      browser.events.errors.length = 0;
      browser.events.requests.length = 0;
      await browser.go(base + path);
      const problems = await browser.evaluate(PAGE_CHECKS);
      const foreign = browser.events.requests.filter((u) => !u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:"));
      const all = [...problems, ...browser.events.errors.map((e) => `lỗi trang: ${String(e).slice(0, 160)}`), ...foreign.map((u) => `gọi ra ngoài: ${u}`)];
      await browser.shot(`${out}/${(path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home")}-${width}.png`);
      if (all.length) { failed++; console.log(`✗ ${path} @${width}`, all); } else console.log(`✓ ${path} @${width}`);
    }
  }
} finally {
  browser.close();
}
process.exit(failed ? 1 : 0);
