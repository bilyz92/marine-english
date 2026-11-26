-- Đường dẫn công khai đọc được (SEO, chủ 26/11/2026): /khoa-hoc/<courses.url_slug>, /khoa-hoc/danh-muc/<course_categories.url_slug>.
-- Mã khóa nội bộ courses.slug giữ nguyên ở mọi chỗ đang dùng (đơn, ghi danh, giấy phép offline, /hoc, /mua, API). Viết tay.

-- Cùng thuật toán với slugify() trong src/modules/content/url-slug.ts: bỏ dấu (đ → d), chữ thường, đoạn không phải chữ/số thành "-",
-- tối đa 80 ký tự, không gạch ở đầu/cuối. translate() đổi chữ có dấu trước lower(): lower() theo locale C chỉ đổi chữ ASCII.
CREATE FUNCTION slugify_vi(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(left(btrim(regexp_replace(lower(translate(normalize(t, NFC),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ',
    'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy')), '[^a-z0-9]+', '-', 'g'), '-'), 80), '-')
$$;

-- Bản thứ n khi trùng: cắt gốc cho vừa 80 ký tự cùng hậu tố "-n" (như withSuffix trong url-slug.ts). Chỉ dùng khi điền dữ liệu cũ.
CREATE FUNCTION pg_temp.with_suffix(base text, n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT rtrim(left(base, 80 - length('-' || n)), '-') || '-' || n
$$;

ALTER TABLE "courses" ADD COLUMN "url_slug" TEXT;
ALTER TABLE "course_categories" ADD COLUMN "url_slug" TEXT;

-- Điền từ tên tiếng Việt theo thứ tự tạo; trùng (với nhau, với mã nội bộ của khóa khác, hay chữ dành riêng) thì thêm -2, -3…
DO $$
DECLARE r record; base text; candidate text; n int;
BEGIN
  FOR r IN SELECT id, title_vi FROM courses ORDER BY created_at, slug LOOP
    base := coalesce(nullif(slugify_vi(r.title_vi), ''), 'khoa-hoc');
    candidate := base;
    n := 1;
    WHILE candidate = 'danh-muc'
       OR EXISTS (SELECT 1 FROM courses WHERE (url_slug = candidate OR slug = candidate) AND id <> r.id) LOOP
      n := n + 1;
      candidate := pg_temp.with_suffix(base, n);
    END LOOP;
    UPDATE courses SET url_slug = candidate WHERE id = r.id;
  END LOOP;
  -- Danh mục và danh mục con chung một không gian phẳng: danh mục cấp 1 chọn trước (theo thứ tự chủ xếp), rồi tới danh mục con.
  FOR r IN SELECT c.id, c.title_vi FROM course_categories c LEFT JOIN course_categories p ON p.id = c.parent_id
           ORDER BY c.parent_id IS NOT NULL, coalesce(p.position, c.position), c.position, c.created_at LOOP
    base := coalesce(nullif(slugify_vi(r.title_vi), ''), 'danh-muc');
    candidate := base;
    n := 1;
    WHILE candidate = 'khac' OR EXISTS (SELECT 1 FROM course_categories WHERE url_slug = candidate) LOOP
      n := n + 1;
      candidate := pg_temp.with_suffix(base, n);
    END LOOP;
    UPDATE course_categories SET url_slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "courses"
  ALTER COLUMN "url_slug" SET NOT NULL,
  ADD CONSTRAINT "courses_url_slug_key" UNIQUE ("url_slug"),
  ADD CONSTRAINT "courses_url_slug_format" CHECK (
    char_length("url_slug") <= 80 AND "url_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "url_slug" <> 'danh-muc');
ALTER TABLE "course_categories"
  ALTER COLUMN "url_slug" SET NOT NULL,
  ADD CONSTRAINT "course_categories_url_slug_key" UNIQUE ("url_slug"),
  ADD CONSTRAINT "course_categories_url_slug_format" CHECK (
    char_length("url_slug") <= 80 AND "url_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "url_slug" <> 'khac');

-- Đường dẫn cũ của khóa: chủ đổi đường dẫn thì link đã chia sẻ vẫn chuyển hướng vĩnh viễn về khóa. Chỉ thêm, không sửa, không xóa.
CREATE TABLE "course_url_slug_history" (
  "url_slug" TEXT NOT NULL PRIMARY KEY CHECK (char_length("url_slug") <= 80 AND "url_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "course_url_slug_history_course_idx" ON "course_url_slug_history" ("course_id");

GRANT UPDATE ("url_slug") ON "courses" TO me_app;
GRANT SELECT, INSERT ON "course_url_slug_history" TO me_app;
