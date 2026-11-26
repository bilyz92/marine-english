# Luyện phỏng vấn Engine Cadet (bài loại "interview", 3 mức) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ tải lên tệp `engine_cadet_interview_questions.xlsx` ở `/admin/noi-dung` (hoặc `pnpm cli content:import <tệp.xlsx>`) và có một khóa nháp mới `mea_cadet_interview` "Luyện phỏng vấn Engine Cadet" / "Engine Cadet Interview Practice", mỗi mã EC một bài, chia theo cột "Chủ đề". Học viên mở bài trong `/hoc` (cả khi mất mạng, sau khi tải khóa) và luyện theo 3 mức L1 "Tập từ đầu", L2 "Luyện từng ý", L3 "Đọc theo mẫu nâng cao", nghe bằng giọng đọc cài trên máy (Mỹ/Anh/Ấn Độ), ghi âm chỉ lưu trên máy.

**Architecture:** Loại bài thứ tư trong nội dung bài, `content.lesson_type = "interview"`, cùng chỗ với `"essay"`/`"video"` (đi theo phiên bản bài, tải offline cùng khóa, quyền xem không đổi). Bộ đọc tệp `src/modules/content/interview-workbook.ts` (hàm thuần, nhận hàm đọc trang) đổi workbook thành **một bộ dữ liệu** đúng định dạng bộ nhập hiện có (`publication.importable`, `courses`, `lessons`, `catalog.modules` làm chủ đề), nên mọi thứ còn lại (phiên bản theo mã băm, xem trước + biên nhận, khóa nháp, 2 bài học thử, chủ đề) dùng lại `importDatasets`. `readPackage` nhận thêm `.xlsx`. Giao diện học: `src/components/study/interview-lesson.tsx` + hàm thuần `src/lib/study/interview.ts` (chọn cách hỏi, trộn lựa chọn, điền chỗ trống, chữ để đọc, tiến độ). Ghi âm: MediaRecorder, lưu Blob trong IndexedDB của học viên (kho `recordings` mới trong DB offline, phiên bản 3; xóa cùng dữ liệu học khi đăng xuất/đổi người); khách học thử chỉ giữ trong bộ nhớ trang. Tiến độ từng mức lưu trên máy (localStorage, khóa `me.study.<người>.<bài>.interview`, đã nằm trong phạm vi `clearStudyData`); đạt đích một mức thì gửi `lesson_completed` qua đường đồng bộ có sẵn. Không bảng mới, không migration ở chặng 1.

**Tech Stack:** Next.js 16, TypeScript, Web Speech API (`speechSynthesis`, chỉ giọng `localService`), MediaRecorder, IndexedDB, Vitest (unit + integration Postgres thật), headless Chrome e2e.

**Spec:** Yêu cầu chủ 25/11/2026 (qua phiên chính): hai tệp của chủ, `engine_cadet_interview_questions.xlsx` (9 trang) và "Thiết kế bài luyện phỏng vấn Engine Cadet theo ba mức tiếng Anh.md". Quyết định chủ: khóa mới (không sửa 3 khóa Engine Cadet cũ), giao theo chặng, chặng 1 không Azure/không gửi âm thanh/không chấm điểm; chặng 2 giọng mẫu ElevenLabs (cập nhật 25/11), chặng 3 chấm phát âm là dịch vụ khác.

## Dữ liệu tệp (đã kiểm 25/11/2026)

- 87 mã câu EC-001…EC-092 (thiếu 4, 5, 14, 19, 49: giữ khoảng trống, IMPORT); cột "Thứ tự" = số trong mã. 17 chủ đề theo thứ tự xuất hiện. Cột "Khả năng hỏi" có cả giá trị "Tanker", "Máy móc", "hay hỏi": hiện nguyên văn.
- Mỗi mã có 1–3 cách hỏi (Cách hỏi), đúng 1 dòng Tập từ đầu, 1–8 đoạn (Luyện từng ý); các đoạn nối lại đúng bằng đáp án cơ bản; Mẫu nâng cao trùng chữ đáp án nâng cao trong Ngân hàng.
- Chỗ trống: `{name}`, `{subject}`, `{tool}` (câu đầu L1 của EC-001, EC-013, EC-064) và nhãn ngoặc `[…]` trong đáp án EC-006, EC-064, EC-066 (EN và VI khác chữ); đáp án mẫu tiếng Việt có thêm nhãn ngoặc chỉ để đọc.
- Khoảng 48 nghìn ký tự tiếng Anh (câu hỏi + 2 đáp án); tính cả cách hỏi, cụm, câu đầu, đoạn ≈ 51 nghìn mỗi giọng.

## Quyết định tạm (chủ duyệt sau)

Chủ giao việc chạy hết chặng 1 không dừng giữa chừng (phiên chính điều phối); các mặc định dưới được chọn sao cho **đổi sau không phải sửa dữ liệu đã nhập hay dữ liệu trên máy**: (a) cách hiển thị, giọng, tốc độ, giới hạn ghi âm, tiêu chí đạt (QĐ 3, 5, 7–10) chỉ là mã giao diện, đổi bằng bản app mới; tiến độ cũ vẫn đọc được (trường thiếu = chưa làm); (b) mã bài, mã chủ đề, cấu trúc nội dung bài và bảng chỗ trống (QĐ 1, 2, 4, 6) nằm trong dữ liệu bài: đổi = sửa bộ đọc rồi nhập lại tệp; mã bài (= mã EC) là thứ duy nhất không nên đổi (tiến độ máy chủ gắn theo bài), nên chốt với chủ trước khi mở bán. Báo cáo cuối liệt kê các mặc định để chủ duyệt.

1. **Mã bài** = mã EC của tệp (`EC-002`): mã bài là toàn cục, các khóa cũ dùng `A001…`, `T001…`, `qb-…` nên không trùng; hiện gọn trong danh sách bài. Chủ đề `T01…T17` theo thứ tự xuất hiện; tên chủ đề lấy nguyên văn cột "Chủ đề".
2. **Câu hỏi hiển thị** (cũng là tên bài trong danh sách): cách hỏi đầu tiên (Q1) EN/VI, nguyên chữ trang Cách hỏi. Ô "Câu hỏi tiếng Anh" của Ngân hàng (danh sách đánh số) giữ trong dữ liệu bài (`bank.question`), không hiện thêm.
3. **Cách hỏi khi học lại:** một "lượt vào bài" = một lần màn bài được dựng cho bài đó (mở từ danh sách, tải lại trang, mở lại khi mất mạng); `visits` tăng đúng một lần mỗi lượt (chống chạy hai lần của React bằng cờ theo lượt dựng), cách hỏi hiện = `variants[(visits - 1) % n]`. Nút "Cách hỏi khác" chỉ đổi cách hỏi đang xem trong lượt này, không đổi `visits`.
4. **Kiểm tra khi nhập (IMPORT, EDIT01):** báo lỗi theo dòng (trang, dòng Excel, mã) và từ chối cả tệp khi: thiếu trang/cột; mã sai dạng `EC-000` hoặc trùng; thiếu câu hỏi, đáp án cơ bản hoặc nâng cao (EN hoặc VI); không có cách hỏi; không có (hoặc có hơn một) dòng Tập từ đầu; không có đoạn; đoạn nối lại khác đáp án cơ bản (so sau khi gộp khoảng trắng); Mẫu nâng cao khác Ngân hàng; dòng ở trang khác trỏ tới mã không có trong Ngân hàng; "Thứ tự" không phải số hoặc trùng trong một mã. Không cố định con số 87: xem trước hiện số bài để chủ đối chiếu.
5. **Chữ giữ nguyên văn** (EC-020, EC-028 như tệp). Chuẩn hóa DATA03 chỉ áp dụng cho chữ đưa vào giọng đọc: bỏ số thứ tự đầu dòng, xuống dòng → ngắt câu, `→` → ", then ", `%` → " percent", `ppm` → " p p m", `CO₂`/`CO2` → "C O 2", "Annex I…VI" → "Annex One…Six", bỏ chỗ trống chưa điền. Danh sách thuật ngữ đầy đủ để chủ duyệt thuộc chặng 2 (cùng lúc tạo audio).
6. **Cá nhân hóa (DATA02):** dùng lại hồ sơ trên máy và form "Thông tin của bạn" (`ProfileFields` của giao diện 3 mức, xuất ra để dùng chung). Bảng chỗ trống → trường hồ sơ cố định trong bộ đọc tệp: `name`→`full_name` (có sẵn), `subject`→`favourite_subject`, `tool` và `[tools actually used]`/`[ghi các dụng cụ…]`→`tools_used`, `[training]`/`[quá trình học tập/huấn luyện]`→`actual_training` (có sẵn), `[describe training or supervised work]`/`[mô tả…]`→`training_experience` (có sẵn), `[give a real example of learning from feedback]`/`[nêu một ví dụ…]`→`feedback_example`. Trường song ngữ lưu riêng EN/VI như hiện nay. Chưa điền: chữ hiện nhãn "(chưa điền: Họ và tên)" có nút điền, giọng đọc bỏ qua chỗ đó và nói rõ "Máy bỏ qua phần bạn chưa điền". EC-001 câu mẫu "Hùng, 33…" là ví dụ của tệp: hiện kèm nhãn "Câu mẫu, thay bằng thông tin thật của bạn" (không tự sửa chữ).
7. **Không có nút "Chấm phát âm"** ở chặng 1 (ẩn hẳn).
8. **"Đã nói được" ở chặng 1 = học viên đã thu một lượt** cho đúng đích (không có máy chấm); "Đã hiểu" = chọn đúng ý ở L1 (L2/L3: đã nghe câu hỏi). Đích để đánh dấu xong bài (gửi `lesson_completed` một lần): L1 = đã hiểu + đã thu câu đầu khi đã ẩn tiếng Anh; L2 = đã thu cả đáp án cơ bản; L3 = đã thu đáp án nâng cao. Đạt bất kỳ mức nào là xong bài; các mức khác vẫn ghi tiến độ riêng. Bài interview **không có** nút chung "Đánh dấu đã học xong" (và không có khối "Hoạt động"): chỉ đạt đích mới gửi `lesson_completed`, đúng một lần.
9. **Giọng:** bộ chọn Mỹ/Philippines/Ấn Độ → `en-US`/`en-PH`/`en-IN` (chủ đổi giọng Anh thành Philippines 26/11/2026), chỉ giọng `localService` (giữ nguyên tắc cũ: giọng mạng có thể gửi chữ ra ngoài). Máy không có giọng đúng vùng → nút vẫn đọc bằng giọng tiếng Anh khác có trên máy và ghi rõ "Máy chưa có giọng Ấn Độ, đang đọc bằng giọng en-US". Không có giọng tiếng Anh nào → ẩn nút Nghe, báo một dòng. Tốc độ: Chậm (0,6) / Thường (1,0), chủ chỉnh 26/11/2026; đổi tốc độ khi đang đọc thì đọc lại câu đó ngay. Lời dẫn tiếng Việt: giọng `vi-VN` cục bộ nếu có, không có thì chỉ hiện chữ. Lựa chọn vùng giọng/tốc độ nhớ trên máy ở khóa mới `me.voice.accent`, `me.voice.rate`; khóa cũ `me.voice` (giọng chọn theo tên ở bài thường) và hàm `pickVoice`/`SpeakButton`/`VoicePicker` không đổi hành vi (test hồi quy).
10. **Ghi âm (AUD02):** "Ghi âm" dừng giọng mẫu, xin quyền mic lần đầu; "Dừng"; sau khi có bản thu: "Nghe giọng mình", "Nghe mẫu", "Thu lại", "Xóa". Đích ghi âm theo trang Mức học: L1 = câu đầu, từng đoạn hoặc cả đáp án cơ bản (đoạn và cả bài ở bước cuối L1, không bắt buộc); L2 = từng đoạn hoặc cả đáp án cơ bản; L3 = cả đáp án nâng cao. Mỗi đích giữ **một** bản thu mới nhất (thu lại thay bản cũ). Khóa bản thu = `<bài>|<mức>|<đích>|<băm chữ đích>`; băm = 12 ký tự đầu sha256 của **chữ đọc cuối cùng** của đích (đã điền hồ sơ và chuẩn hóa, đúng chữ giọng mẫu đọc). Nhập lại tệp có chữ đổi, hoặc học viên sửa thông tin hồ sơ làm chữ đích đổi, thì bản thu cũ không hiện cho chữ mới và bị xóa khi mở bài lần sau (bản thu không khớp đích nào hiện có của bài). Vòng đời: dừng thu, lỗi, thu lại, xóa, đổi đích, đổi mức, rời bài/đóng component đều dừng MediaRecorder, **dừng mọi MediaStreamTrack** (tắt đèn mic), hủy hẹn giờ 2 phút, `URL.revokeObjectURL` cho URL phát cũ, dừng giọng mẫu. Tối đa 2 phút một lượt (tự dừng), tối đa 150 bản thu mỗi học viên trên máy (quá thì xóa bản cũ nhất), có nút "Xóa mọi bản thu của tôi trên máy này". Mic bị từ chối/không hỗ trợ/không lưu được → báo rõ, mọi phần nghe/đọc vẫn dùng được.

## Global Constraints

- Không đổi mã băm và hành vi của bài hỏi–đáp, tự luận, video và 3 khóa Engine Cadet cũ.
- Không thêm bảng, cột hay migration; không thêm route API mới; không gửi âm thanh hay chữ đi đâu (chặng 1).
- Bài interview **không sửa được trên trình soạn bài web** (đổi sẽ xóa `lesson_type` và làm hỏng bài): `saveLesson` trả 400 `interview_readonly`; trang quản trị hiện nhãn "Phỏng vấn (sửa bằng tệp Excel)" và không có nút Sửa. Excel bài giảng (`excel-import.ts`) nối bài thường vào khóa như cũ.
- Nhập lại cùng tệp: không phiên bản mới (mã băm ổn định: dữ liệu bài chỉ phụ thuộc nội dung ô, không phụ thuộc thời gian/tên tệp). `content_version` = `xlsx-` + 12 ký tự sha256 tệp.
- Chữ giao diện tiếng Việt, gọi học viên là "bạn"; UI v2: màu chỉ từ `src/app/tokens.css`, chữ ≥ 15px, nút chạm 52px trên điện thoại, viền 2px; tái dùng lớp CSS có sẵn (`learn.module.css`, `study.module.css`).
- Tránh các tệp đang có người khác sửa (`src/app/(site)/*`, `catalog.ts`, trang danh sách khóa quản trị); ngoại lệ duy nhất: thêm một nhánh `interview` vào trang học thử `src/app/(site)/khoa-hoc/[slug]/hoc-thu/[position]/page.tsx` (bắt buộc để 2 bài học thử mở được).

## Review Focus

1. Bộ đọc tệp: lỗi theo dòng đúng và đủ; nhập lại không tạo phiên bản; chữ trong bài đúng từng ký tự với ô Excel (test so với tệp thật).
2. Không lộ bài trả phí: bài interview đi qua đúng đường quyền như bài khác (manifest, `canOpenLesson`, trang học thử chỉ bài thử của khóa đang bán).
3. Không đọc thành tiếng `{name}`, `[training]`; chữ hiển thị không bị chuẩn hóa.
4. Bản thu không rời máy; xóa khi đăng xuất/đổi người; khách không lưu bền.
5. Mic bị từ chối không làm hỏng màn học.

---

## Chặng 1 (làm bây giờ)

### Task 1: Bộ đọc workbook → bộ dữ liệu

**Files:** Create `src/modules/content/interview-workbook.ts`; Test `tests/unit/interview-workbook.test.ts` (workbook giả dựng trong test bằng hàm đọc trang giả + 1 test đọc tệp thật nếu có ở `tests/fixtures/`).

- [ ] Test trước: workbook hợp lệ nhỏ (2 mã, 2 chủ đề) → 1 khóa `mea_cadet_interview` nháp, 2 bài theo Thứ tự, `catalog.modules` T01/T02, nội dung bài như dưới; mỗi lỗi ở Quyết định 4 → `InterviewWorkbookError.problems` có "Trang …, dòng n, EC-…: …"; cùng đầu vào → cùng JSON.
- [ ] Đọc cột theo tên tiêu đề (dòng có "Mã câu"), không theo vị trí.
- [ ] Nội dung bài:
  ```
  { id, lesson_type: "interview", source_kind: "interview_workbook", source_display_code: "EC-002", module_id: "T02",
    frequency_vi, question: { text: {en, vi} /* Q1 */, variants: [{ id: "EC-002-Q1", order, text: {en, vi} }] },
    bank: { question: {en, vi}, criteria_vi, model_answer_vi },
    basic: {en, vi}, advanced: {en, vi, guidance_vi},
    starter: { lead_vi, correct_vi, distractor_vi, phrase: {en, vi}, first: {en, vi}, instruction_vi, extra: {en, vi} | null },
    segments: [{ id: "EC-002-B1", order, text: {en, vi}, keyword }],
    personalization: { bindings, fields } /* chỉ chỗ trống có trong bài */ }
  ```
- [ ] Bảng chỗ trống (Quyết định 6); chỗ trống không có trong bảng vẫn nhập được (hiện nguyên nhãn, giọng đọc bỏ qua).

### Task 2: Nhập qua web và CLI

**Files:** Modify `src/modules/content/package.ts` (nhánh `.xlsx`), `src/worker/cli.ts` (tệp `.xlsx` đi qua `readPackage`), `package.json` (script `cli` thêm `--experimental-transform-types --import ./src/worker/alias-loader.mjs` để đọc được mã app), `src/app/admin/(panel)/noi-dung/page.tsx` (nhận `.xlsx`, lỗi nhiều dòng). Test `tests/unit/content-package.test.ts`, `tests/integration/content-upload.test.ts` (hoặc `content-import.test.ts`).

- [ ] Test trước: `readPackage(xlsx)` → 1 bộ dữ liệu; tệp `.xlsx` không phải workbook phỏng vấn → 400 rõ ràng; lỗi workbook → `PackageError` chứa danh sách dòng (tối đa 30 dòng + "và n lỗi khác").
- [ ] CLI: integration chạy thật `pnpm cli content:import tests/fixtures/engine-cadet-interview.xlsx` (tiến trình con, DB test): lần 1 mã thoát 0 + số bài; lần 2 "0 phiên bản bài mới"; tệp lỗi → mã thoát khác 0, in các dòng lỗi dễ đọc (không in stack).
- [ ] Integration: nhập tệp → khóa nháp 87 bài (với tệp thật) hoặc theo fixture, 2 bài đầu là học thử, `topics` đúng; nhập lại → 0 phiên bản mới; manifest trả `lessonType: "interview"`.

### Task 3: Không sửa nhầm trên web

**Files:** Modify `src/modules/content/editor.ts` (`lessonTypeOf` nhận `"interview"`, `saveLesson` từ chối), `src/app/admin/(panel)/khoa-hoc/[slug]/course-lessons.tsx` (nhãn, ẩn nút Sửa), `src/modules/learn/manifest.ts` + `src/lib/offline/engine.ts` (kiểu `lessonType`), `src/app/hoc/course-view.tsx` (nhãn "Phỏng vấn"). Test `tests/integration/content-editor.test.ts`.

### Task 4: Hàm thuần cho màn học

**Files:** Create `src/lib/study/interview.ts`; Modify `src/lib/client/speech.ts` (chọn giọng theo vùng, giọng vi-VN, chuẩn hóa chữ đọc); Test `tests/unit/interview-study.test.ts`, `tests/unit/speech.test.ts` (nếu chưa có thì tạo).

- [ ] `variantFor(variants, visits)`, `orderedChoices(correct, distractor, seed)` (trộn ổn định theo lượt), `fillSlots(text, {bindings, fields, profile, lang})` → các phần chữ/ô điền + `missing`, `spokenFrom(parts)` (bỏ ô chưa điền), `speechText(text)` (DATA03), `pickAccentVoice(voices, "US"|"GB"|"IN")` → `{ voice, exact }`, `pickVietnameseVoice`.
- [ ] Tiến độ gắn với nội dung: lưu `contentHash` (mã băm phiên bản bài từ manifest; khách: băm chữ bài); mở bài có mã băm khác → giữ `visits`, `completed`, mức đang chọn; đặt lại bước/đoạn/cờ đã thu (chữ đã đổi). Test với nội dung đổi.
- [ ] Tiến độ: `InterviewProgress = { contentHash, level, visits, spoken: string[], levels: { L1: { step, understood, hideEn, hideVi }, L2: { segment, keywords }, L3: { showText } }, completed }`. "Đã nói" không lưu cờ riêng: `spoken` là danh sách **khóa bản thu** (gồm băm chữ đọc) đã từng thu; một đích tính là đã nói khi khóa hiện tại của nó có trong `spoken`. Đổi hồ sơ hay nhập lại chữ khác → khóa đổi → đích về "chưa nói" cùng lúc bản thu cũ bị ẩn/xóa (một tín hiệu duy nhất). `completed` (đã gửi `lesson_completed`) luôn giữ, không bao giờ gửi lại. Test: thu → đổi hồ sơ → đích chưa nói, `completed` giữ nguyên., `targetReached(progress, level)`, đọc/ghi qua `storage.ts` (khóa `me.study.<người>.<bài>.interview`).

### Task 5: Kho bản thu trên máy

**Files:** Modify `src/lib/offline/db.ts` (kho `recordings`, `DB_VERSION = 3`); Create `src/lib/study/recordings.ts` (`RecordingStore`: `get/put/remove/prune(bài, khóa còn dùng)/clearAll`, giới hạn 150 bản, khóa `<bài>|<mức>|<đích>|<băm chữ đọc>` như Quyết định 10; bản IndexedDB theo identity và bản bộ nhớ cho khách). Test `tests/unit/recordings.test.ts` (fake-indexeddb đã có): lưu/đọc/thay/xóa, giới hạn 150 (xóa cũ nhất), xóa hết, `prune` xóa bản của chữ cũ; unit `recordingKey`: đổi chữ đích hoặc đổi hồ sơ làm chữ đọc đổi → khóa khác; `deleteOfflineDb` (đăng xuất, đổi người, máy bị gỡ → 401 → `clearLocal`) xóa cả bản thu; nâng DB v2 → v3 giữ dữ liệu cũ; bản bộ nhớ của khách không ghi localStorage/sessionStorage/IndexedDB.

### Task 6: Màn học interview

**Files:** Create `src/components/study/interview-lesson.tsx` (+ `recorder.tsx` nếu cần tách); Modify `src/components/study/lesson-study.tsx` (chỉ `export` `ProfileFields`), `src/components/speak.tsx` (xuất kho giọng dùng chung nếu cần), `src/app/hoc/lesson-view.tsx` (nhánh interview, `onComplete` → `finish()` khi chưa xong), trang học thử (nhánh interview, khách = bộ nhớ), `src/components/study/study.module.css` (vài lớp mới bằng token).

- [ ] Thanh trên: nút mức L1/L2/L3 (giữ vị trí từng mức), bộ chọn giọng Mỹ/Anh/Ấn Độ + tốc độ, câu hỏi (cách hỏi theo lượt), "Nghe câu hỏi", "Cách hỏi khác".
- [ ] L1 theo trang Mức học: bước 1 lời dẫn tiếng Việt (nút nghe nếu có giọng Việt) + hướng dẫn; bước 2 nghe câu hỏi, chọn 1 trong 2 ý tiếng Việt (trộn), sai → phát lại cụm + hiện nghĩa + câu hỏi, đúng → "Đã hiểu"; bước 3 cụm then chốt (+ từ thêm) có nghĩa; bước 4 câu đầu (đã điền) nghe/đọc theo/ghi âm, nút "Ẩn tiếng Anh" rồi "Ẩn tiếng Việt"; thu khi đã ẩn tiếng Anh → đạt đích L1; bước 5 mở các đoạn của đáp án cơ bản (đọc, nghe từng đoạn, ghi âm từng đoạn và cả đáp án cơ bản: không bắt buộc, không đổi đích L1).
- [ ] L2: đoạn n/N có nghĩa, "Nghe lại", "Chỉ hiện từ khóa", ghi âm từng đoạn, Trước/Tiếp; sau đoạn cuối: cả đáp án cơ bản, nghe cả bài, thu cả bài → đạt đích L2.
- [ ] L3: nghe câu hỏi + cả đáp án nâng cao, "Xem hướng dẫn" (gập), "Ẩn chữ/Hiện chữ", ghi âm → đạt đích L3. Tiêu chí chuyên môn và đáp án mẫu tiếng Việt trong mục gập "Ý chuyên môn cần có" (L2, L3, cuối L1).
- [ ] Bộ ghi âm: các nút ở Quyết định 10; trạng thái mic bị từ chối/không hỗ trợ; vòng đời giải phóng mic/URL/hẹn giờ ở mọi đường kết thúc.
- [ ] `lesson-view.tsx`: bài interview không có nút "Đánh dấu đã học xong" và khối Hoạt động; `onComplete` gọi `finish()` một lần khi chưa xong.

### Task 7: Kiểm trên trình duyệt thật + tài liệu

**Files:** Create `tests/e2e-ui/interview.mjs`; Modify `CLAUDE.md` (Current state + mục nội dung).

- [ ] Bản build production, nhập tệp thật vào DB dev, đăng nhập học viên được cấp quyền (grant), mở bài ở 360px: L1 chọn sai rồi đúng, ẩn EN/VI, ghi âm bằng mic giả, nghe lại, xóa; ở bước 5 của L1 thu một đoạn và cả đáp án cơ bản (có nút nghe lại cho từng bản); EC-001: thu câu đầu, điền tên, mở lại → bản thu cũ không còn; L2 hai đoạn + thu cả bài; L3 ẩn/hiện chữ, hướng dẫn; đổi mức rồi quay lại giữ vị trí; đổi giọng; mic bị từ chối vẫn học được; tải khóa rồi mở lại khi mất mạng (cách hỏi đổi ở lượt vào sau); không có yêu cầu mạng nào trong lúc ghi âm/phát lại (ghi lại request qua CDP); sau khi thu, rời bài thì track mic đã `ended`; chưa đạt đích thì không có sự kiện `lesson_completed` trong hàng đợi, đạt đích thì có đúng một. Ảnh chụp vào thư mục tạm, báo đường dẫn.
- [ ] Trả DB dev về như cũ (trừ khóa nháp mới).

---

## Chặng 2 (sau, chưa làm): giọng mẫu ElevenLabs tạo sẵn

- Tạo sẵn **một lần cho mỗi (đoạn chữ đọc, phiên bản chữ, giọng)**: 3 giọng thư viện ElevenLabs có giọng Mỹ, Anh, Ấn Độ (chủ chọn sau). Chữ đọc = `speechText` đã duyệt (danh sách thuật ngữ DATA03 chủ duyệt trước khi tạo); bài có chỗ trống cá nhân hóa thì chỉ tạo phần không có chỗ trống, phần có chỗ trống tiếp tục dùng giọng trên máy (không gửi thông tin cá nhân ra ngoài).
- Lưu thành `media_assets` **bảo vệ**, gắn `lesson_version_assets` với vai mới (ví dụ `role = 'voice'` + khóa đích/giọng trong bảng phụ hoặc tên tệp theo mã băm chữ), đi theo bài khi nhập lại như ghi âm hiện nay; tải offline cùng khóa (≈ 87 bài × ~20 đoạn × 3 giọng, ước dung lượng trước khi bật).
- Nghe chậm bằng `playbackRate` ở máy (không tạo thêm bản).
- Khóa API `ELEVENLABS_API_KEY` là secret môi trường, **chỉ** job CLI/worker tạo audio đọc; không bao giờ ở trình duyệt hay `NEXT_PUBLIC_*`. Gọi nhà cung cấp qua một module duy nhất (`src/modules/voice/tts.ts`) để đổi nhà cung cấp được.
- Khối lượng ước tính ≈ 51 nghìn ký tự tiếng Anh mỗi giọng (≈ 155 nghìn cho 3 giọng); tạo lại chỉ đoạn có chữ đổi (theo mã băm).
- Màn học: có audio tạo sẵn thì phát audio (đúng giọng chọn), không có thì quay về giọng trên máy như chặng 1.

## Chặng 3 (sau, chưa làm): chấm phát âm

- Nhà cung cấp riêng (ElevenLabs không có chấm phát âm; ứng viên mặc định Azure Pronunciation Assessment), sau một module duy nhất.
- Chỉ gửi bản thu khi học viên bấm "Chấm phát âm" (opt-in, có lời báo gửi đi đâu), kèm văn bản tham chiếu đúng đích (AI01: L1 câu đầu/đoạn, L2 đoạn/cả bài, L3 cả bài nâng cao; đã cá nhân hóa và chuẩn hóa).
- Bảng lượt thu (DATA01: attempt_id, question, level, target, mode, reference_text, locale, trạng thái âm thanh, điểm hoặc null, góp ý), kết quả đến muộn gắn đúng lượt; im lặng/ồn/lỗi dịch vụ → điểm trống, không ghi 0 (AI03); xóa bản thu xóa cả bản lưu từ xa. Điểm không khóa bài, không xếp hạng chuyên môn (AI04). Hạn mức theo người học, quyền kiểm ở máy chủ theo enrollment. Lịch ôn 1/3/7 ngày (LEARN02) cũng ở chặng này.
