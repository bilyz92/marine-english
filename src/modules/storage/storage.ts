import { env } from "@/lib/env";
import { openProtectedAt, openPublicAt, putFileAt, type Visibility } from "./files";

// Mọi truy cập tệp media đi qua module này (sau này đổi sang S3/R2 chỉ sửa ở đây).

export function putFile(input: { bytes: Buffer; mime: string; visibility: Visibility }, hooks: { beforeRename?: () => void } = {}) {
  return putFileAt(env().MEDIA_ROOT, input, hooks);
}

export function openProtected(storageKey: string) {
  return openProtectedAt(env().MEDIA_ROOT, storageKey);
}

export function openPublic(storageKey: string) {
  return openPublicAt(env().MEDIA_ROOT, storageKey);
}
