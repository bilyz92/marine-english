import { ImageResponse } from "next/og";

// Ảnh xem trước khi chia sẻ (1200×630). Phông mặc định của next/og (Geist, có sẵn trong gói next) có đủ dấu tiếng Việt, không tải
// gì từ mạng. Màu lấy từ tokens.css (ImageResponse không đọc được biến CSS): --color-plate, --color-plate-2, --color-action,
// --color-plate-muted.
const PLATE = "#4c1d95";
const PLATE_2 = "#5b21b6";
const ACTION = "#c2410c";
const PLATE_MUTED = "#ddd6fe";

export const OG_SIZE = { width: 1200, height: 630 };
/** Chữ động (tên khóa…) được xuống dòng cả giữa một chuỗi liền không có dấu cách, để không tràn ảnh. */
export const OG_TEXT_STYLE = { wordBreak: "break-word" } as const;

/** Cắt chuỗi dài ở ranh giới từ để chữ không tràn khung ảnh (tên khóa tối đa 200 ký tự). */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Cỡ chữ tiêu đề theo độ dài: tối đa 3 dòng trong khung 1056px. */
export const titleSize = (length: number) => (length <= 40 ? 72 : length <= 70 ? 60 : 48);

export function ogCard({ eyebrow, title: rawTitle, subtitle: rawSubtitle, footer: rawFooter }: { eyebrow: string; title: string; subtitle?: string; footer: string }) {
  const title = clampText(rawTitle, 100);
  const subtitle = rawSubtitle && clampText(rawSubtitle, 60);
  const footer = clampText(rawFooter, 60);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: PLATE, color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 14, background: PLATE_2, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2" /><path d="M12 7v14" /><path d="M5 12H3a9 9 0 0 0 18 0h-2" /><path d="M8 10h8" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 40 }}>Marine English</div>
            <div style={{ fontSize: 22, letterSpacing: 3, color: PLATE_MUTED }}>{eyebrow}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ ...OG_TEXT_STYLE, fontSize: titleSize(title.length), lineHeight: 1.12 }}>{title}</div>
          {subtitle && <div style={{ ...OG_TEXT_STYLE, fontSize: 32, color: PLATE_MUTED }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 12, height: 48, background: ACTION }} />
          <div style={{ ...OG_TEXT_STYLE, fontSize: 30 }}>{footer}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
