# Chủ thêm nội dung khóa học trên web (02/11/2026)

**Yêu cầu của anh (02/11):** "dựa trên 6 file đó build cho tôi tính năng cho người dùng có thể thêm vào nội dung khóa học". Sáu tệp: `docs/07_Oiler.zip`, `docs/08_Wiper.zip`, `docs/09_Engine_Cadet.zip` (gói học liệu JSON đã biên soạn) và `docs/Engine_Cadet_0{1,2,3}_*_EN.docx` (ngân hàng câu hỏi gốc tiếng Anh, không đáp án). Anh chọn: cả tải gói lên lẫn soạn từng bài; chỉ chủ (owner) làm; Word đọc thành bài học, kèm phát âm bằng giọng nói.

**Mục tiêu:** chủ thêm nội dung không cần lệnh trên máy chủ; nội dung mới luôn vào dạng nháp; học viên nghe được câu tiếng Anh.

## Ràng buộc chung

- Chỉ chủ: quyền mới `content.edit` (OWNER, đăng nhập gần đây ≤ 10 phút như `prices.edit`), mọi thao tác ghi `admin_audit_log`.
- Phiên bản bài/khóa bất biến (trigger `forbid_mutation`): sửa = tạo `lesson_versions`/`course_versions` mới; không UPDATE/DELETE.
- Không tự mở bán: khóa mới `status='draft'`. Nhập vào khóa **đang bán** đổi nội dung học viên đang học: bản xem trước nêu rõ, phải tích xác nhận riêng.
- Không bịa nội dung: Word chỉ có câu hỏi tiếng Anh + câu phụ; không thêm bản dịch, đáp án.
- Không thêm thư viện: đọc zip bằng `node:zlib` (`inflateRawSync` với `maxOutputLength`), có giới hạn chống zip bomb.
- Máy chủ chỉ 1,8 GB RAM: mỗi lúc chỉ một lần nhập/xem trước (khóa trong tiến trình; lần thứ hai trả 429 `busy`), giới hạn theo kích thước tệp thật (xem "Giới hạn").
- Giọng nói: `speechSynthesis` của trình duyệt, **chỉ dùng giọng `localService === true`** (giọng cài trên máy; giọng dịch vụ mạng bị loại vì có thể gửi chữ ra ngoài). Không có giọng tiếng Anh cục bộ thì không hiện nút, ghi chú cách cài giọng. Chữ trên giao diện: "đọc bằng giọng có sẵn trên máy", không hứa chất lượng. Không chấm phát âm (cần Azure Speech, chưa có). Không đọc nhãn chỗ trống `[full_name]` chưa điền.

## Thiết kế

**Quyền DB (migration mới):** `me_app` được `INSERT` trên `lessons`, `lesson_versions`, `course_versions`, `course_version_lessons`, `courses`, và `UPDATE (title_vi, title_en, current_version_id, updated_at)` trên `courses`. Bản ghi phiên bản vẫn bất biến nhờ trigger. Upsert `lessons` đổi thành `INSERT … ON CONFLICT (external_id) DO NOTHING` rồi `SELECT id` (không cần quyền UPDATE trên `lessons`); upsert `courses` giữ `DO UPDATE SET title_vi, title_en, updated_at` (đã có quyền cột). `db-privileges.test.ts` cập nhật theo; test nhập lần đầu và nhập lại **bằng vai `me_app`**.

**Một giao dịch cho mỗi thao tác:** bộ nhập nhận giao diện tối thiểu `Sql = { query(text, params) → rows }`; web bọc `withTx` của Prisma (`$queryRawUnsafe`), CLI bọc `pg.Client` (CLI tự BEGIN/COMMIT). `importDatasets(sql, datasets)` chạy mọi bộ trong gói trong **cùng** giao dịch của route, rồi `audit(tx, …)` ghi thành công cũng trong giao dịch đó; lỗi ở bộ sau hoặc ở audit → ROLLBACK toàn bộ. Xem trước chạy đúng đường này rồi ROLLBACK (ném lỗi nội bộ `DryRun` mang số liệu).

**Tuần tự hóa và chống ghi đè:** mọi thao tác tạo `course_versions` (nhập, sửa, thêm bài) lấy `pg_advisory_xact_lock(hashtext('content-import'))` rồi `SELECT … FROM courses WHERE id = … FOR UPDATE`. Sửa/thêm bài gửi kèm `expectedVersionId` (phiên bản hiện tại mà trang đã đọc; `null` cho khóa chưa có bài); khác với `current_version_id` lúc khóa → 409 `stale`, trang tải lại.

**Khóa đang bán:** mọi thao tác làm đổi `current_version_id` của khóa `published` (nhập gói, sửa bài, thêm bài) cần `confirmLive=true`; thiếu → 409 `needs_confirm` kèm danh sách khóa. Trang hiện hộp xác nhận nêu rõ học viên sẽ thấy nội dung mới.

**Bộ nhập dùng chung** (`src/worker/content-import.ts`): chỉ nhận giao diện `Sql` (mục "Một giao dịch cho mỗi thao tác"); **không** tự BEGIN/COMMIT/ROLLBACK. Người gọi (route web, CLI) nắm giao dịch và việc xem trước. Trả số liệu từng khóa: slug, tiêu đề, số bài, có sẵn chưa, trạng thái, `current_version_id` trước/sau, có phiên bản mới không. Bộ có `related_follow_up_ids` (Oiler/Wiper): giải từ mọi bài, chép câu phụ liên kết vào `linked_follow_up_questions` của bài (Engine Cadet không có trường này nên hash không đổi).

**Đọc gói** (`src/modules/content/package.ts`): đầu vào bytes + tên tệp.
- `.json`: một bộ dữ liệu.
- `.zip`: mọi `*.json` có `courses`+`lessons`+`publication`, cả trong zip lồng một cấp; bỏ trùng theo `dataset_id`+`content_version`; bỏ qua pdf/docx/txt/Thumbs.db.
- `.docx`: `parseQuestionBank` (`src/modules/content/docx.ts`) đọc `word/document.xml` thành câu: mục `Heading2` ("A1 …", "B1 …") là chủ đề; dòng `^([A-Z]{1,2}\d{3})␠␠(.+)$` trong thân (sau "Part A Common questions", trước mục "Supporting material and references" thứ hai) là câu chính; `Follow-up:`, `Extension [Wxx]:`, `Original source:` gắn vào câu đang đọc. Đổi thành bộ dữ liệu: `publication.importable=true`, `status=draft`, một khóa slug từ tên tệp (`engine_cadet_01_tankers_en`), bài id `qb-<chức danh>-<mã>` (vd `qb-engine-cadet-A001`, câu chung dùng chung giữa 3 tập), nội dung `{question:{text:{en}}, follow_up_questions:[{id,prompt:{en}}], module, provenance}`.
- Giới hạn (đặt theo 6 tệp thật: zip lớn nhất 9,3 MB, JSON lớn nhất 4,2 MB, zip lồng lớn nhất 0,7 MB): tệp tải lên ≤ 16 MB; zip ≤ 200 mục; chỉ giải nén mục cần (`.json`, `.zip` lồng một cấp, `word/document.xml` của `.docx`), các mục khác (pdf, docx trong gói, txt) chỉ đọc tên; mỗi mục giải nén ≤ 12 MB (`maxOutputLength`, vượt là dừng ngay), tổng đã giải nén ≤ 48 MB; xử lý từng mục rồi bỏ bytes; không zip64, chỉ phương thức 0/8, tên mục không có `..` hay `/` đầu. Đo RSS đỉnh khi xem trước gói Oiler (ghi vào kế hoạch khi làm xong bước 3), mục tiêu < 250 MB tăng thêm.

**API** `POST /api/quan-tri/content/import?file=<tên>&apply=0|1[&confirmLive=1]` thân là bytes thô (`application/octet-stream`). `apply=0` xem trước (dry run) và trả **biên nhận** ký HMAC (khóa dẫn xuất từ `SESSION_KEY_ADMIN` với nhãn mục đích riêng) chứa: admin id, sha256 tệp, danh sách khóa bị ảnh hưởng kèm `current_version_id` và `status` lúc xem, cờ `confirmLive`, hạn 15 phút. `apply=1` bắt buộc header `x-preview-receipt`: chữ ký đúng, chưa hết hạn, cùng admin, sha256 thân khớp, và (trong giao dịch, sau khi khóa) trạng thái các khóa vẫn đúng như biên nhận; sai bất kỳ → 409 `stale_preview`. Đường dẫn này được loại khỏi `matcher` của `src/proxy.ts` (proxy đệm thân request, mặc định giới hạn 10 MB); handler tự `requireAdmin` + `authorize("content.edit")`, kiểm `content-length` và độ dài thật. nginx: `location = /api/quan-tri/content/import { client_max_body_size 16m; … }` (khớp giới hạn của app: thân là bytes thô nên không có phần thêm của multipart); tệp lớn hơn bị nginx trả 413 trước khi tới Next.js (kiểm bằng curl trên máy chủ sau deploy).

**Thời gian giao dịch:** nhập/xem trước gói dùng `withTx(fn, { txTimeoutMs: 60_000, statementTimeoutMs: 20_000, lockTimeoutMs: 5_000, retries: 0 })`; sửa/thêm bài dùng mặc định (`lockTimeoutMs` 3 s). Khóa (advisory hoặc `FOR UPDATE`) chờ quá hạn (`55P03`) → 409 `busy` "Đang có thao tác nội dung khác, thử lại sau ít giây"; giao dịch quá `txTimeoutMs` → 503 `timeout`, không ghi gì. Đo thời gian nhập thật gói Oiler (120 bài) ở bước 3 và ghi vào đây; nếu vượt 30 s thì gom lệnh INSERT theo lô trước khi làm tiếp.

**Soạn từng bài:**
- `GET /api/quan-tri/content/courses/[slug]`: danh sách bài của phiên bản hiện tại (vị trí, mã, câu hỏi, học thử).
- `GET …/lessons/[externalId]`: nội dung bài.
- `PUT …/lessons/[externalId]` (sửa) và `POST …/lessons` (thêm bài cuối khóa, mã `<slug>-b<n>`): body là các trường soạn được (câu hỏi en/vi, 3 ý, từ vựng, đáp án mẫu, câu phụ); giữ nguyên các trường khác của bài; tạo `lesson_version` mới (hoặc dùng lại theo hash) và `course_version` mới với bài đó thay vào đúng vị trí; chỉ đổi khóa đang mở.
- `POST /api/quan-tri/content/courses`: tạo khóa nháp mới (slug, tên vi/en), chưa có phiên bản.
- Thêm bài vào khóa **chưa có phiên bản** (`current_version_id` null, `expectedVersionId=null`): tạo `course_versions` version 1 với một dòng `course_version_lessons` (vị trí 1, học thử theo quy tắc 3 bài đầu) và gán `current_version_id` trong cùng giao dịch.
- Trang `/admin/noi-dung` (nhập gói) và `/admin/khoa-hoc/[slug]` (danh sách bài, sửa, thêm). Menu chỉ hiện với chủ.

**Hiển thị bài + Nghe:**
- `LessonBody` chịu được từ vựng dạng `{en,vi}` (Oiler/Wiper) và hiện `linked_follow_up_questions`.
- Bài không có đáp án mẫu (bài từ Word, hoặc chưa soạn): **không** hiện thẻ "Đáp án mẫu" và nút mở đáp án; không có ý chính thì không hiện mục đó. Không tạo nội dung thay thế.
- `SpeakButton`: đọc tiếng Anh bằng `speechSynthesis`, chọn giọng Anh (ưu tiên giọng người dùng chọn: Mỹ/Anh/Ấn/Philippines nếu máy có, nhớ trong localStorage), ẩn nếu trình duyệt không hỗ trợ hoặc không có giọng tiếng Anh. `speakableText` thay `[…]` bằng khoảng lặng ngắn; khi có nhãn trống hiện ghi chú "Phần trong ngoặc là thông tin của anh, máy không đọc". Nút cho câu hỏi, ý chính, đáp án mẫu (khi đã mở), câu phụ.

## Các bước (TDD, xanh test sau mỗi bước, Codex review trước mỗi commit)

1. Migration quyền + bộ nhập (dry run, `Queryable`, câu phụ liên kết). Test: db-privileges; content-import (dry run không ghi; linked follow-ups; Engine Cadet giữ hash cũ).
2. Đọc zip + gói + Word. Test unit: zip lưu/deflate, chặn `..`, vượt `maxOutputLength` (zip bomb nén cao), quá số mục, zip lồng; docx mẫu nhỏ dựng trong test. **Kiểm bắt buộc trên tệp thật:** 3 tệp Word chuyển vào `docs/Engine_Cadet_Three_Levels_v6/nguon/` và JSON học liệu Oiler, Wiper (kèm txt hướng dẫn, tệp validation) vào `docs/Oiler_Bilingual_Three_Levels_v1/`, `docs/Wiper_Bilingual_Three_Levels_v1/` (như bộ Engine Cadet đã có), cùng commit; test không được bỏ qua: Word 58/59/58 câu chính, T001–T002/H001–H003/K001–K002, số câu phụ và mở rộng, không lẫn W01…; Oiler 120 bài, 3 khóa 98/99/95; Wiper 107 bài, 86/87/82. Ba tệp zip gốc (26 MB) không commit; kiểm bằng `node scripts/check-content-packages.mjs docs/*.zip` (chạy tay trong bước 3, ghi kết quả vào kế hoạch).
3. API nhập + quyền + audit + proxy/nginx. Test integration: nhập bộ cỡ thật (Oiler JSON đã commit) đo thời gian; sửa bài khi nhập đang giữ khóa → 409 `busy`; hỗ trợ bị 403; chủ cũ (quá 10 phút) bị 403 reauth; xem trước không ghi; apply thiếu/sai/hết hạn biên nhận, biên nhận của tệp khác, khóa đổi sau xem trước → 409; khóa đang bán cần `confirmLive`; gói 2 bộ mà bộ thứ hai lỗi → không ghi gì; lỗi khi ghi audit → không ghi gì; nhập lại không tạo phiên bản mới; hai lần nhập đồng thời → một lần 429; audit ghi sha và số liệu.
4. Trang `/admin/noi-dung`. Kiểm bằng trình duyệt (tests/e2e-ui/content.mjs).
5. API + trang soạn bài. Test integration: sửa tạo phiên bản mới, bài cũ không đổi; khóa mới rỗng → thêm bài đầu tiên tạo version 1; thêm bài; khóa khác dùng chung bài không bị đổi; khóa đang bán cần `confirmLive` cho cả sửa và thêm; hai lần sửa cùng `expectedVersionId` → một lần 409 `stale`; sửa trong lúc nhập gói → không mất thay đổi nào (lần sau bị 409); hỗ trợ 403; audit.
6. `LessonBody` + `SpeakButton`. Test unit: `speakableText`, `pickVoice` (chỉ giọng cục bộ tiếng Anh; không có → null). e2e: bài từ Word không có thẻ đáp án; nút Nghe ẩn khi không có giọng cục bộ (giả lập `speechSynthesis`), hiện và gọi `speak` khi có.
7. Tài liệu (runbook, CLAUDE.md), deploy (nginx + bản mới), nhập thử Oiler/Wiper trên máy chủ ở dạng nháp nếu anh đồng ý.

## Rủi ro

- Grant INSERT cho `me_app` nới quyền: app bị chiếm có thể thêm phiên bản rác hoặc đổi `current_version_id`. Chấp nhận vì chủ cần sửa trên web; mọi thay đổi qua route có quyền chủ + audit.
- Đổi `current_version_id` của khóa đang bán: học viên thấy nội dung mới ở lần tải sau; tiến độ gắn theo bài nên giữ được.
