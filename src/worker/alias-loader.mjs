// Cho phép chạy thẳng mã TypeScript của app bằng Node: ánh xạ "@/" → src/ và bổ sung phần mở rộng còn thiếu.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function asFile(path) {
  if (/\.[cm]?[jt]sx?$/.test(path) && existsSync(path)) return path;
  return [`${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(existsSync) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let path = null;
    if (specifier.startsWith("@/")) path = resolvePath(SRC, specifier.slice(2));
    else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith("file:")) path = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = path && asFile(path);
    return file ? nextResolve(pathToFileURL(file).href, context) : nextResolve(specifier, context);
  },
});
