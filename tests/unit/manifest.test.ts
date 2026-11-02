import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

// Cài app lên điện thoại (PWA): Android cần icon PNG 192 và 512 trong manifest; app mở thẳng vào /hoc.
describe("manifest cài app", () => {
  it("có icon PNG 192 và 512 (tệp có thật trong public), mở vào /hoc, chạy như app riêng", () => {
    const m = manifest();
    expect(m).toMatchObject({ start_url: "/hoc", scope: "/", display: "standalone" });
    for (const size of ["192x192", "512x512"]) {
      const icon = m.icons?.find((i) => i.sizes === size && i.type === "image/png");
      expect(icon, size).toBeTruthy();
      expect(existsSync(`public${icon!.src}`)).toBe(true);
    }
  });
});
