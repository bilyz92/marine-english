// Phần thuần của bài video (docs/superpowers/plans/2026-11-12-video-lessons.md): nhận diện tệp theo byte đầu, tách mã YouTube.
// Không import gì của máy chủ để test và trình duyệt dùng được.

/** Giới hạn một tệp video (Quyết định tạm 1); khớp client_max_body_size ở nginx và max_size ở Caddy. */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/**
 * Nhãn chính ISO BMFF nhận làm video mp4/m4v. Nhãn khác bị từ chối: .mov của iPhone (`qt  `), tệp chỉ có tiếng (`M4A `…),
 * ảnh AVIF/HEIF, 3GP. Chỉ kiểm vỏ tệp, không kiểm codec (chủ xem lại ngay sau khi tải lên).
 */
const VIDEO_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP", "dash"]);

/** mp4/m4v (hộp `ftyp`, nhãn chính cho phép) hoặc webm (EBML, DocType "webm"); không tin đuôi tệp. */
export function sniffVideo(head: Buffer): "video/mp4" | "video/webm" | null {
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    return VIDEO_BRANDS.has(head.subarray(8, 12).toString("latin1")) ? "video/mp4" : null;
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return head.subarray(0, 64).toString("latin1").includes("webm") ? "video/webm" : null;
  }
  return null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const EMBED_HOSTS = new Set([...WATCH_HOSTS, "youtube-nocookie.com", "www.youtube-nocookie.com"]);

/** Mã video 11 ký tự từ link YouTube chủ dán; link khác (host lạ, mã sai) → null. Chỉ lưu mã, không lưu link thô. */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = segments[0];
  else if (WATCH_HOSTS.has(host) && segments[0] === "watch") id = url.searchParams.get("v");
  else if (EMBED_HOSTS.has(host) && (segments[0] === "embed" || segments[0] === "shorts")) id = segments[1];
  return id && YOUTUBE_ID.test(id) ? id : null;
}
