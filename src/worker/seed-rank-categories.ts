// Gieo 9 danh mục chức danh cho trang Khóa học (docs/superpowers/plans/2026-11-14-course-categories.md, Task 4). Chỉ tạo, không ghi đè:
// chạy lại (kể cả lỡ tay) không sửa tên, thứ tự, ảnh hay cách gắn khóa chủ đã chỉnh trên trang quản trị.
// node --experimental-transform-types --import ./src/worker/alias-loader.mjs src/worker/seed-rank-categories.ts <thư mục 9 ảnh>
// Cần các biến môi trường của app (DATABASE_URL vai trò me_app, MEDIA_ROOT, …), như tiến trình worker.
import path from "node:path";
import { disconnectDb, prisma } from "@/lib/db";
import { applyCategoryLayout, type CategoryLayoutEntry } from "@/modules/content/categories";

const TANKER_BULK_CONTAINER = (rank: string) => [`mea_${rank}_tanker`, `mea_${rank}_bulk`, `mea_${rank}_container`];

/** Thứ tự = thứ tự ô trên trang. Ảnh: 9 ảnh riêng chủ gửi 14/11/2026 (đã in tên Anh + Việt), sha256 16 ký tự đầu. */
const LAYOUT: (Omit<CategoryLayoutEntry, "imageFile"> & { image: string })[] = [
  { seedKey: "rank:cadet", titleVi: "Thực tập máy", titleEn: "Engine Cadet", image: "cadet.jpg", imageSha16: "ac2c3a0ba276e891",
    courses: ["mea_cadet_tanker", "engine_cadet_container", "engine_cadet_dry_cargo"] },
  { seedKey: "rank:wiper", titleVi: "Phụ máy", titleEn: "Wiper", image: "wiper.jpg", imageSha16: "05920fa0685aaf80", courses: ["mea_wiper_tanker"] },
  { seedKey: "rank:oiler", titleVi: "Thợ máy", titleEn: "Oiler", image: "oiler.jpg", imageSha16: "e205527609940e68", courses: ["mea_oiler_tanker"] },
  { seedKey: "rank:fitter", titleVi: "Thợ sửa chữa cơ khí", titleEn: "Fitter", image: "fitter.jpg", imageSha16: "fc53f26bb5814740", courses: TANKER_BULK_CONTAINER("fitter") },
  { seedKey: "rank:eto", titleVi: "Sĩ quan kỹ thuật điện", titleEn: "ETO", image: "eto.jpg", imageSha16: "42cf9037ad178e7a", courses: TANKER_BULK_CONTAINER("eto") },
  { seedKey: "rank:4e", titleVi: "Máy tư", titleEn: "4/E", image: "4e.jpg", imageSha16: "f37ed68de0a714c0", courses: TANKER_BULK_CONTAINER("4e") },
  { seedKey: "rank:3e", titleVi: "Máy ba", titleEn: "3/E", image: "3e.jpg", imageSha16: "6a298409403e7a47", courses: TANKER_BULK_CONTAINER("3e") },
  { seedKey: "rank:2e", titleVi: "Máy hai", titleEn: "2/E", image: "2e.jpg", imageSha16: "55abdae512302001", courses: TANKER_BULK_CONTAINER("2e") },
  { seedKey: "rank:ce", titleVi: "Máy trưởng", titleEn: "C/E", image: "ce.jpg", imageSha16: "a32a57c0a1d03a68", courses: TANKER_BULK_CONTAINER("ce") },
];

const dir = process.argv[2];
if (!dir) {
  console.error("Cách dùng: seed-rank-categories.ts <thư mục chứa cadet.jpg, wiper.jpg, … ce.jpg>");
  process.exit(2);
}
try {
  // Người thao tác: tài khoản chủ đang hoạt động sớm nhất (nhật ký ghi ip::inet nên cần IP hợp lệ).
  const [owner] = await prisma().$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM admin_users WHERE role = 'owner' AND status = 'active' ORDER BY activated_at LIMIT 1`;
  if (!owner) throw new Error("Chưa có tài khoản chủ đang hoạt động");
  const ctx = { adminId: owner.id, role: "owner", sessionId: "cli-seed-rank-categories", authAt: new Date(), ip: "127.0.0.1" };
  const result = await applyCategoryLayout(ctx, LAYOUT.map(({ image, ...e }) => ({ ...e, imageFile: path.resolve(dir, image) })));
  console.log(`Đã tạo: ${result.created.join(", ") || "(không)"}`);
  console.log(`Đã có, bỏ qua: ${result.skipped.join(", ") || "(không)"}`);
  console.log(`Đã gắn khóa: ${result.assigned.join(", ") || "(không)"}`);
  console.log(`Giữ cách gắn của chủ: ${result.keptAssignment.join(", ") || "(không)"}`);
  console.log(`Khóa đang bán còn ở "Khóa khác": ${result.uncategorizedPublished.join(", ") || "(không)"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
