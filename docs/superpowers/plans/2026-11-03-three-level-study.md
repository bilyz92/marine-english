# Giao diện học 3 mức trong app học (03/11/2026)

**Yêu cầu của anh:** "đồng ý, làm giao diện 3 mức đi". Mẫu tham khảo: `docs/Engine_Cadet_Learner_Web_v6/` (trang học thử chạy riêng, không đăng nhập). Màu giữ theo website hiện tại (tím); bố cục và cách học theo mẫu và theo `02_YEU_CAU_TICH_HOP*.txt` trong các gói học liệu.

**Mục tiêu:** trang bài trong app `/hoc` và trang học thử có 3 nút mức trên cùng một bài. Mức 1 học từng bước nhỏ, Mức 2 trả lời theo 3 ý, Mức 3 tự trả lời rồi mới xem mẫu. Có bài tập có đáp án, bản nháp, điền chỗ trống theo hồ sơ thật. Dùng chung cho Engine Cadet, Oiler, Wiper. Giữ đăng nhập, quyền học và học offline đang có.

## Ràng buộc

- Không bịa nội dung. Chỉ hiện chữ có trong dữ liệu: bước nhỏ, đáp án ngắn, ý chính, cách hỏi khác, câu phụ, bài tập, giải thích. Bài không có `learning_material` (bài từ Word, bài soạn trên web) vẫn hiện như hiện nay (`LessonBody`).
- Không tự cấp "đạt bài". Đổi mức, nghe, chọn đúng trắc nghiệm không ghi thành thạo. Không chấm điểm AI, không ghi âm.
- Hồ sơ cá nhân là thật và riêng tư.
  - Chỉ hỏi trường mà bài đang mở cần, không bắt điền hết.
  - Chỗ trống chưa có giá trị giữ nguyên nhãn ngoặc, kèm nút "Điền thông tin". Không suy ra "chưa có kinh nghiệm" từ ô trống.
  - Bộ có `binding_scope` (Oiler, Wiper) tra theo cặp (phạm vi bài, nhãn ngoặc).
- Giọng đọc dùng `SpeakButton` sẵn có (chỉ giọng cục bộ). Đọc câu đã điền hồ sơ; chỗ trống chưa điền thì bỏ qua như hiện nay.
- Học offline: mọi thứ cần cho 3 mức nằm trong nội dung bài đã tải về (đã qua kiểm quyền). Hồ sơ, mức đang chọn và bản nháp lưu trên máy.
- Màu, cỡ chữ, bo góc dùng biến có sẵn trong `src/app/tokens.css` và `src/app/hoc/learn.module.css`. Bấm được bằng ngón tay (ít nhất 44 px), điện thoại 360 px không tràn ngang.

## Thiết kế

### Dữ liệu: bộ nhập gắn thêm vào từng bài

Trong `src/worker/content-import.ts`, khi tạo nội dung bài, gắn thêm (chỉ khi bộ dữ liệu có các phần này):

- **`exercises`**: các mục của `learning_exercises` có `lesson_id` trùng mã bài, giữ nguyên thứ tự trong tệp.
- **`personalization`**:
  - `bindings`: các mục `placeholder_bindings` mà nhãn ngoặc có xuất hiện trong chữ của bài (câu hỏi, đáp án, bước nhỏ, câu phụ, bài tập, kể cả câu phụ liên kết). Bộ có `binding_scope` chỉ lấy mục trùng mã bài, hoặc trùng phạm vi của câu phụ gốc khi câu phụ đó được liên kết vào.
  - `fields`: định nghĩa các trường hồ sơ được dùng (`key`, nhãn tiếng Việt và tiếng Anh, kiểu), lấy từ `profile_contract.fields`.
- Mã băm nội dung đổi theo, nên lần nhập lại sẽ tạo phiên bản bài mới. Không đổi bảng, không cần migration.

### Hồ sơ trên máy (bản đầu)

- `src/lib/client/learner-profile.ts` lưu giá trị hồ sơ trong `localStorage` theo mã học viên (`me.profile.<userId>`), đọc và ghi an toàn (try/catch), chỉ trên máy đó.
- Đồng bộ hồ sơ lên máy chủ để dùng nhiều máy là bước sau, có ghi trong "Chưa làm".

### Logic thuần (test được)

`src/lib/study/` gồm:

- **`personalize(text, ctx)`**:
  - Thay `[nhãn]` bằng giá trị hồ sơ theo `bindings` của bài (theo phạm vi nếu có).
  - Trả `{ text, missing: FieldDef[] }`. Nhãn không có binding thì giữ nguyên.
- **`pickAlternative(unit, profile)`**: chọn `short_answer_alternatives` hoặc `model_answer.alternatives` có `condition {profile_field, equals}` đúng với hồ sơ. Không khớp, hoặc trường đang trống, thì dùng đáp án gốc.
- **`checkExercise(exercise, input)`**:
  - Điền từ và nhớ cụm từ: so sánh sau khi bỏ hoa thường, khoảng trắng thừa và dấu câu ở cuối.
  - Trắc nghiệm: so `answer_option_id`.
  - Trả `{ correct, feedback }`.
- **`levelData(lesson, levelId)`**: lấy bước nhỏ, bài tập và ý chính theo `levels[].micro_unit_ids / exercise_ids / required_point_ids`. Mã không tìm thấy thì bỏ qua và ghi cảnh báo trong console dev.
- **`studyState`** (theo học viên và bài, trong `localStorage`): mức đang chọn, bước hiện tại, bản nháp theo từng mức, cờ "đã dùng gợi ý" theo từng lượt.
  - Mức mặc định: mức đã lưu của bài, rồi mức ưu tiên của tài khoản (lưu khi đổi), cuối cùng là Mức 1.

### Giao diện

`src/components/study/` có `LessonStudy` (dùng chung cho `/hoc` và trang học thử):

- **Đầu bài:** mã bài, câu hỏi tiếng Anh và tiếng Việt (Mức 3 ẩn tiếng Việt lúc đầu), nút Nghe, nút lưu bài (đánh dấu trên máy). Bên dưới là 3 nút: "Mức 1 · Mới bắt đầu", "Mức 2 · Cơ bản", "Mức 3 · Khá/Tốt". Đổi mức không mất bản nháp.
- **Mức 1:**
  - Hiện một bước nhỏ mỗi lần, có "Bước n/tổng", câu hỏi nhỏ Anh/Việt, "Xem/Ẩn đáp án", "Hiện/Ẩn nghĩa", Nghe.
  - Nút "Trước" / "Tiếp theo". Hết các bước thì hiện bài tập Mức 1 và nút "Sang Mức 2".
  - Có các cụm từ hữu ích (`useful_phrases`) nếu dữ liệu có.
- **Mức 2:**
  - Câu hỏi đầy đủ và đúng 3 ý chính.
  - Ô "Câu trả lời của tôi" (bản nháp), bài tập Mức 2 (trắc nghiệm hiểu nghĩa).
  - Nút "Đối chiếu đáp án mẫu" chỉ mở được sau khi đã viết hoặc bấm "Tôi đã tự nói". Mở gợi ý trước khi trả lời thì ghi "đã dùng gợi ý".
- **Mức 3:**
  - Chỉ hiện câu hỏi; tiếng Việt, ý chính và đáp án ẩn.
  - "Đổi cách hỏi" xoay qua `question.variants` (không có thì không hiện nút).
  - Ô trả lời hoặc nút "Tôi đã tự nói" → hiện đáp án mẫu và 3 ý để tự đối chiếu.
  - Câu phụ (của bài và câu liên kết), mỗi câu có đáp án riêng, mở sau khi thử.
- **Hồ sơ:** trường còn thiếu của bài đang mở hiện thành một dải "Điền để đáp án dùng thông tin của bạn". Bấm vào mở hộp nhập đúng các trường đó, lưu trên máy.
- **Bài tập:** điền từ hoặc trắc nghiệm, có nút "Kiểm tra" và hiện phản hồi đúng/sai từ dữ liệu. Không ghi điểm lên máy chủ.

## Các bước (TDD, Codex review trước mỗi commit)

1. **Bộ nhập gắn `exercises` và `personalization`.**
   - Test tích hợp:
     - Engine Cadet A001 có 3 bài tập điền từ và 1 trắc nghiệm; `bindings` có `name` → `full_name`; `fields` có nhãn.
     - Oiler OL-A001-INTRO chỉ có binding đúng phạm vi bài.
     - Bộ không có `learning_exercises` (fixture, Word) thì không có trường mới.
     - Nhập lại cùng tệp không tạo phiên bản mới.
2. **`src/lib/study/` và hồ sơ trên máy.**
   - Test unit cho `personalize`:
     - điền đủ;
     - thiếu trường thì giữ nhãn và báo thiếu;
     - nhãn tiếng Việt và tiếng Anh cùng trường;
     - có phạm vi thì không dùng nhầm binding của bài khác.
   - Test unit cho `pickAlternative`, `checkExercise` (hoa thường, dấu câu, trắc nghiệm), `levelData` (A046 đủ 7 bước), và chọn mức mặc định.
3. **`LessonStudy` và gắn vào `/hoc` và trang học thử** (bài không có `learning_material` vẫn dùng `LessonBody`).
   - Kiểm thử trình duyệt `tests/e2e-ui/study.mjs` trên trang học thử của khóa có dữ liệu 3 mức (dev):
     - đổi 3 mức vẫn đúng mã bài;
     - Mức 1 đi đủ các bước, có "Sang Mức 2";
     - bài tập điền từ trả lời đúng/sai đúng phản hồi;
     - Mức 2 chưa trả lời thì chưa xem được mẫu;
     - Mức 3 ẩn tiếng Việt lúc đầu;
     - bản nháp còn sau khi đổi mức và tải lại;
     - điền hồ sơ tên thì đáp án mẫu đổi theo;
     - điện thoại 360 px không tràn, không lỗi trang.
4. **Tài liệu và deploy.** Cập nhật CLAUDE.md, ghi "Chưa làm". Deploy khi anh đồng ý. Khóa trên máy chủ cần nhập lại tệp JSON (CLI hoặc `/admin/noi-dung`) để có dữ liệu mới.

## Chưa làm (để sau)

- Đồng bộ hồ sơ, mức và bản nháp lên máy chủ (dùng nhiều máy).
- Lịch ôn cách quãng 1/3/7/14/30 ngày.
- Phỏng vấn thử (`interview_sessions`).
- Audio thật.
- Chấm phát âm.

## Rủi ro

- Hồ sơ lưu trên máy: đổi máy phải nhập lại. Dữ liệu không rời máy (riêng tư), có ghi rõ trên giao diện.
- Nội dung bài lớn hơn vì có bài tập và binding (A001 thêm khoảng 5 KB). Tải offline vẫn nhỏ.

## Quyết định khi làm (03/11/2026)

- Codex hết credit lúc duyệt kế hoạch: làm tiếp, một reviewer Claude độc lập soát bản code đầu, sau đó Codex duyệt khi có credit lại.
- Theo review độc lập, đã sửa:
  - Sang bài khác trong `/hoc` không còn mang bản nháp, bước, mức của bài trước (dựng lại phần học theo học viên và bài).
  - Câu phụ liên kết điền theo bài gốc (`origin_scope` gắn lúc nhập).
  - Trường song ngữ có ô tiếng Anh và ô tiếng Việt riêng; câu tiếng Anh không bao giờ nhận chữ tiếng Việt.
  - Luôn có nút "Sửa thông tin".
  - Đăng xuất xóa hồ sơ và bài làm trên máy; trang học thử chỉ lưu trong phiên trình duyệt.
  - Thêm lại từ vựng (Mức 1) và thẻ ôn (Mức 2).
  - Chỉ hỏi trường của phần chữ đang hiện. Ô tuổi là ô số, ô ngày là ô chọn ngày. Kết quả bài tập được đọc cho trình đọc màn hình.
- Để sau:
  - `pickAlternative`: đáp án thay thế đang hiện thành danh sách "Nếu …" cho học viên tự chọn, chưa tự chọn theo hồ sơ.
  - Cờ "đã dùng gợi ý", nút lưu bài.
  - Kiểu và giới hạn đầy đủ cho từng trường hồ sơ.
  - Trình soạn bài trên web chưa cập nhật `personalization` khi thêm chỗ trống mới.
