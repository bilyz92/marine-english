-- Tên chức danh mới (chủ 17/11/2026, src/app/(site)/dang-nhap/ranks.ts): đổi các tên cũ đã lưu sang tên mới.
UPDATE "users" SET "rank" = CASE "rank"
  WHEN 'Máy trưởng' THEN 'MÁY TRƯỞNG - C/E'
  WHEN 'Máy hai' THEN 'MÁY HAI - 2/E'
  WHEN 'Máy ba' THEN 'MÁY BA - 3/E'
  WHEN 'Máy tư' THEN 'MÁY TƯ - 4/E'
  WHEN 'Thợ cả' THEN 'THỢ CẢ - FITTER'
  WHEN 'Thợ máy' THEN 'THỢ MÁY - MOTORMAN'
  WHEN 'Thực tập sinh máy' THEN 'THỰC TẬP SINH MÁY - ENGINE CADET'
  WHEN 'Bộ phận boong' THEN 'BỘ PHẬN BOONG - DECK DEPARTMENT'
  WHEN 'Đang học trường hàng hải' THEN 'ĐANG HỌC TRƯỜNG HÀNG HẢI - MARITIME STUDENT'
  WHEN 'Khác / chưa xác định' THEN 'KHÁC / CHƯA XÁC ĐỊNH - OTHER / UNSPECIFIED'
END
WHERE "rank" IN ('Máy trưởng', 'Máy hai', 'Máy ba', 'Máy tư', 'Thợ cả', 'Thợ máy', 'Thực tập sinh máy',
                 'Bộ phận boong', 'Đang học trường hàng hải', 'Khác / chưa xác định');
