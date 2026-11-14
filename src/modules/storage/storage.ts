import { env } from "@/lib/env";
import { openProtectedAt, openPublicAt, putFileAt, putStreamAt, type Visibility } from "./files";

// Mọi truy cập tệp media đi qua module này (sau này đổi sang S3/R2 chỉ sửa ở đây).

export function putFile(input: { bytes: Buffer; mime: string; visibility: Visibility }, hooks: { beforeRename?: () => void } = {}) {
  return putFileAt(env().MEDIA_ROOT, input, hooks);
}

/** Tệp lớn (video) theo luồng, không đệm cả tệp trong RAM. */
export function putStream(input: Parameters<typeof putStreamAt>[1]) {
  return putStreamAt(env().MEDIA_ROOT, input);
}

export function openProtected(storageKey: string) {
  return openProtectedAt(env().MEDIA_ROOT, storageKey);
}

export function openPublic(storageKey: string) {
  return openPublicAt(env().MEDIA_ROOT, storageKey);
}

/** URL của tệp công khai (route src/app/media/[key]; ở production Caddy/nginx phục vụ thẳng thư mục media/public cùng đường dẫn). */
export function publicMediaUrl(storageKey: string): string {
  return `/media/${storageKey}`;
}
