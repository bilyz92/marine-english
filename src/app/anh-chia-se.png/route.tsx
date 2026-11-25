import { ogCard } from "../(site)/og-card";

// Ảnh chia sẻ mặc định của site (1200×630), địa chỉ cố định /anh-chia-se.png: trang nào tự đặt openGraph thì Next bỏ ảnh
// opengraph-image của layout, nên pageMetadata (src/lib/seo.ts) gắn thẳng địa chỉ này. Chữ lấy từ trang chủ; không số liệu, không hứa hẹn.
export function GET() {
  return ogCard({
    eyebrow: "CONGHUNG TANKER C/E",
    title: "Tiếng Anh cho thuyền viên bộ phận máy",
    subtitle: "Bài do máy trưởng tàu dầu soạn, giải thích bằng tiếng Việt",
    footer: "Học trên điện thoại, học được cả khi tàu mất mạng",
  });
}
