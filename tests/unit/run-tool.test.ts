import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTool } from "@/modules/ops/run-tool";

const dir = () => mkdtempSync(join(tmpdir(), "me-run-"));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("runTool", () => {
  it("nối các bước bằng pipe, đọc stdin từ tệp, ghi stdout ra tệp", async () => {
    const d = dir();
    writeFileSync(join(d, "in"), "b\na\nc\n");
    await runTool([{ cmd: "sort", args: [] }, { cmd: "tr", args: ["a-z", "A-Z"] }], { stdinFile: join(d, "in"), stdoutFile: join(d, "out"), signal: new AbortController().signal });
    expect(readFileSync(join(d, "out"), "utf8")).toBe("A\nB\nC\n");
  });

  it("bước đầu lỗi dù bước sau thành công → lỗi; thông báo không chứa biến môi trường bí mật", async () => {
    const d = dir();
    const error = await runTool([{ cmd: "sh", args: ["-c", "echo $SECRET >&2; exit 3"], env: { SECRET: "bi-mat-123" } }, { cmd: "cat", args: [] }], { stdoutFile: join(d, "out"), signal: new AbortController().signal }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("sh");
    expect((error as Error).message).not.toContain("bi-mat-123");
  });

  it("lỗi kèm đoạn cuối stderr để chẩn đoán (công cụ không in mật khẩu)", async () => {
    const error = await runTool([{ cmd: "sh", args: ["-c", "echo 'pg_dump: error: connection refused' >&2; exit 1"] }], { signal: new AbortController().signal }).catch((e: Error) => e);
    expect((error as Error).message).toContain("connection refused");
  });

  it("hủy → SIGTERM; tiến trình bỏ qua SIGTERM bị SIGKILL; khi hàm trả về thì đã thoát hẳn", async () => {
    const d = dir();
    const controller = new AbortController();
    const pidFile = join(d, "pid");
    const run = runTool([{ cmd: "sh", args: ["-c", `trap '' TERM; echo $$ > ${pidFile}; while true; do sleep 0.1; done`] }], { signal: controller.signal, killAfterMs: 300 });
    await new Promise((r) => setTimeout(r, 300));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(alive(pid)).toBe(true);
    controller.abort();
    await expect(run).rejects.toThrow();
    expect(alive(pid)).toBe(false);
  });

  it("tín hiệu đã hủy sẵn → không chạy gì", async () => {
    const d = dir();
    const controller = new AbortController();
    controller.abort();
    await expect(runTool([{ cmd: "sh", args: ["-c", `touch ${join(d, "ran")}`] }], { signal: controller.signal })).rejects.toThrow();
    expect(() => readFileSync(join(d, "ran"))).toThrow();
  });
});
