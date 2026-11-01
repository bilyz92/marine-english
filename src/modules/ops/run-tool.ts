import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";

export type Step = { cmd: string; args: string[]; env?: Record<string, string> };
export type RunOptions = { stdinFile?: string; stdoutFile?: string; signal: AbortSignal; killAfterMs?: number };
export type RunTool = (steps: Step[], opts: RunOptions) => Promise<void>;

const KILL_AFTER_MS = 10_000;
const STDERR_TAIL = 500;

/** Kết thúc cả nhóm tiến trình (tiến trình con có thể sinh tiến trình cháu). */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Đã thoát.
  }
}

/**
 * Chạy các bước nối bằng pipe như `a | b | c`. Bí mật đi qua `env`, không qua tham số; thông báo lỗi chỉ nêu tên lệnh và mã thoát.
 * Hủy → SIGTERM cả nhóm, quá hạn thì SIGKILL; chỉ trả về khi mọi tiến trình đã thoát hẳn.
 */
export const runTool: RunTool = async (steps, opts) => {
  opts.signal.throwIfAborted();
  const fds: number[] = [];
  const input = opts.stdinFile ? openSync(opts.stdinFile, "r") : "ignore";
  const output = opts.stdoutFile ? openSync(opts.stdoutFile, "w", 0o600) : "ignore";
  if (typeof input === "number") fds.push(input);
  if (typeof output === "number") fds.push(output);
  const children: ChildProcess[] = [];
  try {
    for (const [i, step] of steps.entries()) {
      const stdin = i === 0 ? input : children[i - 1]!.stdout!;
      const stdout = i === steps.length - 1 ? output : "pipe";
      children.push(spawn(step.cmd, step.args, {
        stdio: [stdin, stdout, "pipe"],
        // Chỉ truyền biến cần thiết: công cụ không thấy khóa phiên, khóa ký… của tiến trình worker.
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", ...step.env } as unknown as NodeJS.ProcessEnv,
        detached: true,
      }));
      // Bước sau đã nhận đầu đọc của pipe; bản giữ ở tiến trình này phải đóng, không thì bước trước không bao giờ kết thúc.
      if (i > 0) children[i - 1]!.stdout!.destroy();
    }
    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      for (const c of children) signalGroup(c, "SIGTERM");
      killTimer = setTimeout(() => children.forEach((c) => signalGroup(c, "SIGKILL")), opts.killAfterMs ?? KILL_AFTER_MS);
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });
    const stderr = children.map(() => "");
    children.forEach((child, i) => child.stderr?.on("data", (chunk: Buffer) => { stderr[i] = (stderr[i] + chunk.toString()).slice(-STDERR_TAIL); }));
    const results = await Promise.all(children.map((child, i) => new Promise<{ cmd: string; code: number | null; signal: string | null; error?: Error }>((resolve) => {
      child.once("error", (error) => resolve({ cmd: steps[i]!.cmd, code: null, signal: null, error }));
      // "close" (không phải "exit"): đợi đọc hết stderr, nếu không đoạn chẩn đoán có thể mất khi máy tải nặng.
      child.once("close", (code, signal) => resolve({ cmd: steps[i]!.cmd, code, signal }));
    })));
    opts.signal.removeEventListener("abort", onAbort);
    clearTimeout(killTimer);
    if (opts.signal.aborted) throw new Error("tool_aborted");
    const index = results.findIndex((r) => r.error || r.code !== 0);
    if (index >= 0) {
      const failed = results[index]!;
      // Kèm đoạn cuối stderr để chẩn đoán; che mọi giá trị biến môi trường truyền vào (mật khẩu DB…) phòng khi công cụ in ra.
      let tail = stderr[index]!.trim();
      for (const value of Object.values(steps[index]!.env ?? {})) if (value.length >= 4) tail = tail.split(value).join("***");
      throw new Error(`tool_failed:${failed.cmd}:${failed.error ? "spawn" : (failed.code ?? failed.signal)}${tail ? `: ${tail}` : ""}`);
    }
  } finally {
    fds.forEach(closeSync);
  }
};
