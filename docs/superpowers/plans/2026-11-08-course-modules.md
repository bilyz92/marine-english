# Module khóa học + bài tự luận (chặng 1/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ (admin) tự tạo, đặt tên, sắp thứ tự module cho từng khóa và xếp bài vào module; thêm loại bài "tự luận" (học viên viết rồi tự đối chiếu đáp án mẫu); học viên đã mua thấy bài theo Module → Chủ đề → Bài; người chưa mua chỉ thấy tên module, nội dung bên trong mờ và không lộ; admin tải được khung bài giảng mẫu (Excel), điền rồi tải lên thành bài.

**Architecture:** Module là dữ liệu cấp khóa, không theo phiên bản: bảng `course_modules` và bảng xếp bài `course_lesson_modules` khóa theo `lessons.id` (không theo phiên bản bài), nên sửa bài trên web hay nhập lại học liệu không làm mất cách xếp. Loại bài nằm trong nội dung bài (`content.lesson_type`, vắng = hỏi–đáp) để đi cùng phiên bản và tải offline. Manifest, trang khóa công khai và trang quản trị trả thêm `modules` và `moduleId`/`lessonType` của từng bài; nhóm hiển thị dựng ở trình duyệt.

**Tech Stack:** Next.js 16 App Router, Prisma 7 raw SQL, PostgreSQL 16, Vitest, headless Chrome e2e (`tests/e2e-ui`).

**Spec:** Quyết định của chủ ngày 08/11/2026 (trong hội thoại, ghi lại ở đây): mỗi khóa chia thành module do admin tự tạo (ví dụ Module 1 "Kinh nghiệm phỏng vấn", Module 2 "Kinh nghiệm vận hành sửa chữa"); bài hỏi–đáp đang có vào Module 1; khi thêm bài admin chọn module và loại bài; loại bài: hỏi–đáp (có sẵn), tự luận (học viên tự đối chiếu, học offline), video (chặng 2: tải lên máy chủ có kiểm quyền và tải về học offline, hoặc link YouTube), nói theo (chặng 3: nghe mẫu, tự ghi âm trên máy rồi nghe lại; chặng 4: chấm phát âm tự động Azure). Chủ đề A1…D1 giữ làm nhóm nhỏ trong module. Module riêng từng khóa. Bổ sung 09/11/2026: người chưa mua khóa chỉ thấy tên module, phần trong làm mờ, "không ai có thể nhìn thấy được" (3 bài học thử giữ hiện và học được, chủ chưa trả lời câu hỏi này nên giữ như cũ); "làm cho tôi khung bài giảng mẫu và admin có thể tải về": chủ chọn **file Excel** (tải về, điền, tải lên thành bài).

## Global Constraints

- Màu chỉ lấy từ `src/app/tokens.css`; chữ ≥ 15px, vùng bấm theo `--touch`/`--touch-main` (CLAUDE.md, UI v2).
- Không đổi nội dung hay mã băm của bài hỏi–đáp đang có: bài hỏi–đáp **không** ghi `lesson_type` (vắng = hỏi–đáp), để nhập lại học liệu vẫn "0 phiên bản bài mới".
- Quyền: xem = `orders.view`, sửa = `content.edit` (chủ); mọi thao tác sửa ghi `admin_audit_log`.
- Đổi module không tạo phiên bản khóa mới, không đụng `course_versions` (bất biến).
- Bài tự luận: bản nháp chỉ lưu trên máy theo người học (`saveLessonState(who, lessonId, …)`), không gửi lên máy chủ; học được khi mất mạng.
- Chữ trên giao diện tiếng Việt, gọi người học là "bạn".
- Bài tự luận phải có đáp án mẫu (không có thì học viên không có gì để đối chiếu): thiếu → 400 `essay_needs_answer`.
- Nhập lại học liệu không được làm mất bài chủ thêm trên web (`content.source_kind === "web_editor"`): các bài đó giữ nguyên, nối sau các bài của bộ nhập, đúng thứ tự cũ.
- Cách xếp module của một bài chỉ có hiệu lực khi bài đang nằm trong phiên bản hiện tại của khóa; bài bị bộ nhập bỏ khỏi khóa thì dòng xếp được giữ (bài quay lại thì về đúng module cũ) nhưng không tính vào số bài, không hiện, và không chặn xóa module (xóa module thì xóa luôn các dòng xếp của bài không còn trong khóa).
- Trang khóa công khai và API `/api/public/courses/[slug]` không gửi tên/nội dung bài nào ngoài 3 bài học thử; chỉ gửi tên module, tên chủ đề không gửi, số bài mỗi module.

## Review Focus

1. Nhập lại học liệu hoặc sửa bài trên web sau khi đã xếp module → bài vẫn ở module cũ (test ở Task 2).
2. Một bài dùng chung 3 khóa: xếp module ở khóa này không làm đổi khóa khác; gửi `moduleId` của khóa khác → 404 (Task 1).
3. Máy học viên còn manifest cũ không có `modules` → app vẫn mở, hiện theo chủ đề như trước (Task 3).
4. Xóa module còn bài → bị từ chối, không mất bài (Task 1).
5. Hai người dùng chung một điện thoại: nháp tự luận của người này không hiện cho người kia (Task 4).
6. Người chưa mua xem mã nguồn trang khóa hoặc gọi API công khai → không thấy tên bài ngoài học thử (Task 7).

---

## File Structure

- Create `prisma/migrations/20261108090000_course_modules/migration.sql`: hai bảng, ràng buộc, quyền.
- Modify `prisma/schema.prisma`: model `CourseModule`, `CourseLessonModule`.
- Create `src/modules/content/modules.ts`: đọc/sửa module (dịch vụ máy chủ).
- Create routes `src/app/api/quan-tri/content/courses/[slug]/modules/route.ts` (GET, POST), `.../modules/[moduleId]/route.ts` (PATCH, DELETE), `.../lessons/[externalId]/module/route.ts` (PUT).
- Modify `src/modules/content/editor.ts` (loại bài, module khi thêm bài, danh sách có module), `src/modules/learn/manifest.ts`, `src/modules/content/catalog.ts`, `src/lib/offline/engine.ts` (kiểu manifest).
- Modify `src/lib/offline/topics.ts`: thêm `groupByModule`.
- Create `src/components/study/essay-lesson.tsx`: màn bài tự luận.
- Modify `src/app/hoc/course-view.tsx`, `src/app/hoc/lesson-view.tsx`, `src/app/(site)/khoa-hoc/[slug]/page.tsx`, `src/app/(site)/khoa-hoc/[slug]/hoc-thu/[position]/page.tsx`, `src/app/admin/(panel)/khoa-hoc/[slug]/course-lessons.tsx` (+ tách `course-modules.tsx`).
- Modify `src/lib/study/storage.ts` (kiểu nháp tự luận, `updateLessonState`), `src/worker/content-import.ts` (giữ bài soạn trên web).
- Task 7–8: `src/app/api/public/courses/[slug]/route.ts`, `src/app/(site)/khoa-hoc/[slug]/course.module.css`, khung Excel (xem Task 8).
- Tests: `tests/integration/course-modules.test.ts`, `tests/integration/excel-import.test.ts`, `tests/unit/excel-import.test.ts`, bổ sung `content-editor.test.ts`, `content-import.test.ts`, `learn-access.test.ts`, `catalog.test.ts`; `tests/unit/lesson-topics.test.ts`, `tests/unit/study-storage.test.ts`; e2e `tests/e2e-ui/modules.mjs`.

---

### Task 1: Bảng module và dịch vụ quản trị module

**Files:** migration, `prisma/schema.prisma`, `src/modules/content/modules.ts`, 3 route ở trên, `tests/integration/course-modules.test.ts`

**Interfaces — Produces:**
- `listModules(ctx: AdminCtx, slug: string): Promise<{ modules: { id: string; titleVi: string; position: number; lessonCount: number }[] }>`
- `createModule(ctx, slug, titleVi: string): Promise<{ id: string }>` — module đầu tiên của khóa đã có bài: mọi bài của phiên bản hiện tại được xếp vào nó.
- `renameModule(ctx, slug, moduleId: string, titleVi: string): Promise<void>`
- `moveModule(ctx, slug, moduleId: string, direction: "up" | "down"): Promise<void>` — đổi chỗ với module kề; ở đầu/cuối thì không làm gì.
- `deleteModule(ctx, slug, moduleId): Promise<void>` — còn bài → `HttpError(409, "module_not_empty")`.
- `setLessonModule(ctx, slug, externalId: string, moduleId: string): Promise<void>` — bài phải thuộc phiên bản hiện tại của khóa; module phải thuộc khóa (khác → 404).
- `modulesFor(db, courseId: string): Promise<{ modules: { id: string; titleVi: string }[]; lessonModule: Map<string /* lessons.id */, string /* moduleId */> }>` — dùng ở Task 2.
- Route: `GET|POST /api/quan-tri/content/courses/[slug]/modules` (body `{ titleVi }`), `PATCH /…/modules/[moduleId]` (body `{ titleVi } | { move: "up"|"down" }`), `DELETE /…/modules/[moduleId]`, `PUT /…/lessons/[externalId]/module` (body `{ moduleId }`).

Bảng: `course_modules(id uuid pk default gen_random_uuid(), course_id uuid not null references courses, title_vi text not null check (char_length(btrim(title_vi)) between 1 and 120), position int not null, created_at timestamptz default now(), unique (course_id, position) deferrable initially deferred, unique (course_id, id))`; `course_lesson_modules(course_id uuid not null, lesson_id uuid not null references lessons, module_id uuid not null, primary key (course_id, lesson_id), foreign key (course_id, module_id) references course_modules (course_id, id) on delete restrict)`. `GRANT SELECT, INSERT, UPDATE, DELETE` cả hai bảng cho `me_app`. Thao tác sửa khóa dòng `courses … FOR UPDATE` để hai người sửa cùng lúc không trùng vị trí.

- [ ] **Step 1: Viết test hỏng** (`seedContent()`, `adminSess("owner")`, `callAdmin` như `lesson-audio.test.ts`):
  - `tạo module đầu: 4 bài của engine_cadet_tanker vào module đó; module thứ hai rỗng, đứng sau` — `listModules` trả `[{titleVi:"Kinh nghiệm phỏng vấn", position:1, lessonCount:4}, {titleVi:"Kinh nghiệm vận hành sửa chữa", position:2, lessonCount:0}]`; audit `module_create` 2 dòng.
  - `đổi tên, chuyển xuống/lên đổi chỗ; chuyển lên ở đầu không đổi gì`.
  - `xếp bài A002 sang module 2: khóa dry_cargo (dùng chung A002) không đổi` — `listModules("engine_cadet_dry_cargo")` vẫn rỗng; module của khóa khác → 404.
  - `xóa module còn bài → 409 module_not_empty; chuyển hết bài đi rồi xóa → ok, vị trí còn lại liền mạch (1..n)`.
  - `tên rỗng hoặc > 120 ký tự → 400; người hỗ trợ (support) tạo/sửa → 403, xem → 200`.
  - `mỗi thao tác ghi đúng nhật ký`: `module_create` (after: titleVi, position, assignedLessons), `module_rename` (before/after titleVi), `module_move` (before/after position), `module_delete` (before: titleVi, position), `lesson_module_set` (before/after moduleId); `targetType` `course_module` / `lesson`.
  - `bài bị bộ nhập bỏ khỏi khóa: không tính vào lessonCount, module xóa được; nhập lại có bài đó → về module cũ`.
- [ ] **Step 2:** `pnpm vitest run --project integration tests/integration/course-modules.test.ts` → FAIL (route chưa có).
- [ ] **Step 3:** Viết migration, model Prisma, `modules.ts`, các route (theo mẫu `lessons/[externalId]/audio/route.ts`: `requireAdmin`, `readJson` với zod).
- [ ] **Step 4:** Chạy lại → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** `/codex-impl-review` tới APPROVE, commit `feat(content): course modules the owner creates, names, orders and fills`.

### Task 2: Loại bài tự luận, module khi thêm bài, dữ liệu đọc có module

**Interfaces — Consumes:** `modulesFor` (Task 1). **Produces:**
- `LessonFields` thêm `lessonType: z.enum(["qa", "essay"]).default("qa")`; `SaveLesson` thêm `moduleId: z.uuid().optional()`. `applyFields`: `essay` → `content.lesson_type = "essay"`; `qa` → xóa khóa `lesson_type` (bài cũ giữ nguyên mã băm).
- `saveLesson` thêm bài mới: khóa đã có module mà thiếu `moduleId` → `HttpError(400, "module_required")`; có `moduleId` → ghi `course_lesson_modules` trong cùng giao dịch (module sai khóa → 404).
- `courseLessons` mỗi bài thêm `moduleId: string | null`, `lessonType: "qa" | "essay"`; kết quả thêm `modules: { id, titleVi }[]`.
- Manifest (`src/modules/learn/manifest.ts`, kiểu ở `src/lib/offline/engine.ts`): `modules: { id: string; titleVi: string }[]`, mỗi bài `moduleId: string | null`, `lessonType: "qa" | "essay"`. Client: các trường này **tùy chọn** (manifest cũ đã lưu).
- `saveLesson`: `lessonType === "essay"` mà `modelAnswerEn` trống → `HttpError(400, "essay_needs_answer")` (cả khi đổi loại bài cũ sang tự luận). Thêm bài có module → nhật ký `lesson_add` thêm `after.moduleId`.
- Bộ nhập (`src/worker/content-import.ts`, vòng khóa): trước khi dựng danh sách thành viên mới, lấy các bài `source_kind = "web_editor"` của phiên bản hiện tại không có trong bộ nhập, nối vào cuối (giữ `is_free_trial` tính lại theo vị trí như hiện nay).
- `storage.ts`: `LessonState.drafts` đổi kiểu thành `Partial<Record<LevelId | "essay", string>>`; thêm `updateLessonState(who, lessonId, patch: Partial<LessonState>)` đọc rồi ghép (giữ trường khác).

- [ ] **Step 1: Test hỏng**
  - `content-editor.test.ts`: `thêm bài tự luận vào module 2: nội dung có lesson_type "essay", nằm ở module 2`; `khóa có module, thêm bài không chọn module → 400 module_required`; `sửa bài hỏi–đáp cũ không đổi loại → mã băm như cũ (không phiên bản bài mới)`.
  - `course-modules.test.ts`: `sửa bài A002 trên web và nhập lại content-mini.json: A002 vẫn ở module 2` (Review Focus 1).
  - `learn-access.test.ts`: manifest có `modules` theo thứ tự, `lessons.map(l => l.moduleId)` đúng, `lessonType` = `"qa"` cho bài cũ.
  - `content-editor.test.ts`: `tự luận không có đáp án mẫu → 400 essay_needs_answer; đổi bài cũ sang tự luận khi chưa có đáp án → 400`.
  - `content-import.test.ts`: `nhập lại học liệu giữ bài tự luận chủ thêm trên web, ở cuối khóa, vẫn đúng module`.
  - `tests/unit/study-storage.test.ts`: `updateLessonState giữ level/step/exercises khi ghi drafts.essay`.
- [ ] **Step 2:** chạy 4 file → FAIL.
- [ ] **Step 3:** Cài đặt như Interfaces.
- [ ] **Step 4:** PASS; `pnpm test` toàn bộ xanh.
- [ ] **Step 5:** Codex, commit `feat(content): essay lessons and module on add; manifest and course page carry modules`.

### Task 3: Học viên thấy Module → Chủ đề → Bài

**Interfaces — Produces:** `groupByModule<L extends { moduleId?: string | null; topic?: string | null; status: … }>(modules: { id: string; titleVi: string }[] | undefined, topics: { id: string; titleVi: string }[] | undefined, lessons: L[]): { id: string | null; titleVi: string; done: number; total: number; open: boolean; topics: TopicGroup<L>[] | null; lessons: L[] }[] | null` trong `src/lib/offline/topics.ts`. Không có module → `null` (giữ hiển thị theo chủ đề như hiện tại). Bài không thuộc module nào → nhóm cuối "Bài khác". Mở sẵn module có bài đang học, nếu không thì module đầu còn bài chưa xong. Trong mỗi module dùng `groupByTopic` với các bài của module đó.

- [ ] **Step 1: Unit test hỏng** `tests/unit/lesson-topics.test.ts`: `hai module, chủ đề bên trong mỗi module`, `bài chưa xếp → Bài khác ở cuối`, `manifest cũ (modules undefined) → null`, `mở module có bài đang học`.
- [ ] **Step 2:** FAIL. **Step 3:** viết `groupByModule`; `course-view.tsx` (trang khóa công khai làm ở Task 7): có module thì mỗi module là một khối (tiêu đề "Module n · tên", số bài đã xong/tổng), bên trong là các chủ đề gập mở như hiện tại; không có thì giữ nguyên. Bài tự luận có nhãn "Tự luận" cạnh mã bài.
- [ ] **Step 4:** PASS; chụp `/hoc?khoa=…` ở 360/390/1280, sáng và tối: không tràn (`PAGE_CHECKS`).
- [ ] **Step 5:** Codex, commit `feat(learn): lessons grouped by module, then topic`.

### Task 4: Màn bài tự luận

**Interfaces — Produces:** `EssayLesson({ externalId, content, who }: { externalId: string; content: LessonContent & { lesson_type?: string }; who: string })` trong `src/components/study/essay-lesson.tsx`. Hiện đề (tiếng Anh, nút Nghe, nghĩa tiếng Việt), ý cần có (gập), ô viết; nháp lưu `updateLessonState(who, externalId, { drafts: { …cũ, essay } })` mỗi lần gõ (ghép, không ghi đè trạng thái khác của bài); nút "Đối chiếu đáp án mẫu" khóa tới khi ô viết có chữ; mở ra đáp án mẫu và ý chính để tự so; câu "Không cần giống từng chữ: đủ ý và đúng nghĩa là được." `lesson-view.tsx` và trang học thử chọn `EssayLesson` khi `content.lesson_type === "essay"`.

Trang học thử dùng người học chung `GUEST` (sessionStorage, đóng trình duyệt là mất) như các bài học thử khác; trong `/hoc` dùng mã học viên (localStorage, xóa khi đăng xuất).
- [ ] **Step 1:** e2e `tests/e2e-ui/modules.mjs` phần học viên (viết trước), tách hai cảnh: (a) học thử bài tự luận: nút đối chiếu khóa khi trống, gõ chữ → mở được đáp án, tải lại trang (cùng phiên) → nháp còn; (b) trong `/hoc`, học viên A có khóa (cấp không thu tiền), bấm "Tải khóa về máy" và chờ khối tải biến mất (tải xong), mở bài tự luận viết nháp, tắt mạng (`Network.emulateNetworkConditions offline`), tải lại bài vẫn mở và còn nháp; bật lại mạng, đăng xuất, học viên B (cũng được cấp không thu tiền cùng khóa trước khi chuyển tài khoản) đăng nhập cùng máy, mở bài đó khi có mạng → ô viết có trên trang và trống (Review Focus 5). Unit test thêm: trạng thái có sẵn `{ level, exercises }` vẫn còn sau khi gõ nháp tự luận.
- [ ] **Step 2:** chạy → FAIL. **Step 3:** viết component, nối vào hai trang. **Step 4:** PASS, không lỗi `PAGE_CHECKS` ở 360/390.
- [ ] **Step 5:** Codex, commit `feat(learn): essay lessons: write, then compare with the model answer`.

### Task 5: Trang quản trị: module và loại bài

**Interfaces — Consumes:** route Task 1, `SaveLesson.lessonType/moduleId` Task 2.

- Trang `/admin/khoa-hoc/<slug>`: khối "Module" trên danh sách bài: từng module (tên sửa tại chỗ, nút ↑ ↓, Xóa khi rỗng), ô "Tên module mới" + nút "Thêm module". Chưa có module: dòng giải thích "Tạo module đầu tiên: mọi bài hiện có sẽ vào module này."
- Danh sách bài nhóm theo module; mỗi bài có ô chọn "Module" (đổi là lưu ngay, báo "Đã chuyển bài …"), nhãn loại bài.
- Form thêm/sửa bài: ô "Loại bài" (Hỏi–đáp / Tự luận); khi thêm bài và khóa có module: ô "Module" bắt buộc. Với tự luận, nhãn "Câu hỏi" đổi thành "Đề bài", "Câu hỏi phụ" ẩn.

- [ ] **Step 1:** e2e `tests/e2e-ui/modules.mjs` phần quản trị (viết trước): tạo module 1 → bài cũ vào đó; tạo module 2; thêm bài tự luận vào module 2; đổi thứ tự; xóa module còn bài bị báo; 360/1280 không lỗi giao diện.
- [ ] **Step 2:** FAIL. **Step 3:** tách `course-modules.tsx`, sửa `course-lessons.tsx`. **Step 4:** PASS cả file `modules.mjs`; chạy lại `content.mjs`, `study.mjs`, `learner-nav.mjs`.
- [ ] **Step 5:** Codex, commit `feat(admin): owner manages modules and lesson types on the course page`.

### Task 7: Người chưa mua chỉ thấy module, phần trong mờ

**Interfaces — Produces:** `getPublishedCourse` (thay kết quả ở Task 2) trả `{ …card, modules: { id: string | null; titleVi: string; lessonCount: number; trial: { position: number; externalId: string; title: string }[] }[] }`: không còn `lessons`, `topics`; bài không phải học thử chỉ còn con số. Khóa chưa có module → một nhóm `{ id: null, titleVi: "Nội dung khóa học", … }`; khóa có module mà còn bài chưa xếp → thêm nhóm cuối `{ id: null, titleVi: "Bài khác", … }`. Tổng `lessonCount` các nhóm luôn bằng `lessonCount` của khóa (test). Trang `/khoa-hoc/[slug]`: mỗi module một khối (tên, "n bài"), bên trong các dòng học thử hiện rõ, còn lại là `min(lessonCount − trial, 4)` dòng giả bị làm mờ (`filter: blur`, `aria-hidden`, chữ giả cố định "Bài học trong khóa") cùng dòng "Mua khóa để mở n bài" và nút Mua/Vào học (`BuyOrLearn`). Học viên đã mua xem đủ ở `/hoc`.

- [ ] **Step 1: Test hỏng** `catalog.test.ts`: `API công khai không chứa câu hỏi của bài không học thử` (chuỗi JSON không có câu hỏi T001), `mỗi module có lessonCount đúng và đủ 3 bài học thử`; e2e trong `modules.mjs`: HTML trang khóa (khách) không chứa câu hỏi bài thứ 4, có 3 nút "Học thử", có dòng mờ.
- [ ] **Step 2:** FAIL. **Step 3:** sửa catalog, route công khai, trang khóa, CSS. **Step 4:** PASS; `shots.mjs` cho `/khoa-hoc/<slug>` không lỗi. **Step 5:** Codex, commit `feat(sales): course page shows modules only; lessons stay hidden until bought`.

### Task 8: Khung bài giảng mẫu (Excel): tải về, điền, tải lên thành bài

Chủ chọn Excel (09/11/2026). Không thêm thư viện: `.xlsx` là tệp zip chứa XML; đọc bằng `src/modules/content/zip.ts` (`readZip`) và đọc XML theo kiểu `docx.ts`; khung mẫu là tệp tĩnh dựng một lần bằng script.

**Files:** Create `scripts/build-lesson-template.mjs` (ghi `src/assets/khung-bai-giang-mau.xlsx`: tự dựng các tệp XML tối thiểu của xlsx, chữ dùng inline string, có độ rộng cột, dòng tiêu đề in đậm và cố định), `src/assets/khung-bai-giang-mau.xlsx` (commit), `src/modules/content/xlsx.ts`, `src/modules/content/excel-import.ts`, routes `src/app/api/quan-tri/content/template/route.ts` (GET tải khung) và `src/app/api/quan-tri/content/courses/[slug]/excel/route.ts` (POST thân là bytes thô; `?confirm=1` mới ghi), nút ở `/admin/khoa-hoc/<slug>` ("Tải khung bài giảng (Excel)", "Tải lên file Excel").

Khung: sheet 1 "Hướng dẫn" (cách điền từng cột, loại bài hợp lệ, giới hạn, điền xong tải lên ở trang khóa); sheet 2 "Bài học", dòng 1 là tiêu đề cột, cố định đúng thứ tự:
`Module * | Mã chủ đề | Tên chủ đề | Loại bài * (Hỏi–đáp / Tự luận) | Câu hỏi / Đề bài (tiếng Anh) * | Câu hỏi / Đề bài (tiếng Việt) | Ý chính (mỗi dòng: tiếng Anh | tiếng Việt) | Từ vựng (mỗi dòng: tiếng Anh | tiếng Việt) | Đáp án mẫu (tiếng Anh) | Đáp án mẫu (tiếng Việt) | Câu hỏi phụ (mỗi dòng: tiếng Anh | tiếng Việt)`;
dòng 2–3 là hai bài mẫu lấy nguyên từ học liệu Engine Cadet (A001 hỏi–đáp; tự luận dùng câu hỏi A022 và đáp án mẫu có sẵn của nó), không bịa nội dung.

**Interfaces — Produces:**
- `readSheetRows(bytes: Buffer, sheetName: string): string[][]` (`xlsx.ts`): đọc chuỗi chia sẻ và chuỗi inline, ô trống thành `""`, giữ xuống dòng trong ô. Giới hạn chống tệp nén độc: tối đa 50 mục trong zip (`readZip(bytes, { maxEntries: 50 })`), mỗi mục đọc tối đa 8 MB (`entry.read(8 * 1024 * 1024)`, đọc theo số byte giải nén thật, không tin kích thước khai báo), tổng đã giải nén tối đa 20 MB; vượt → `HttpError(400, "file_too_complex")`. Test: tệp XML 30 MB toàn khoảng trắng nén còn vài chục KB → 400; mục khai báo kích thước nhỏ nhưng giải nén lớn → 400.
- `parseLessonSheet(rows: string[][]): { lessons: ExcelLesson[]; errors: { row: number; message: string }[] }` (`excel-import.ts`): kiểm tiêu đề cột đúng khung (sai → một lỗi dòng 1 "Không đúng khung mẫu"); bỏ dòng trống; `Loại bài` "Hỏi–đáp" | "Tự luận" (khác, kể cả "Video", "Nói theo" → lỗi "Loại bài chưa hỗ trợ"); thiếu Module hoặc câu hỏi tiếng Anh → lỗi; tự luận thiếu đáp án mẫu tiếng Anh → lỗi; tối đa 300 bài.
- `importExcel(ctx, slug, bytes, { confirm: boolean; expectedVersionId: string | null; confirmLive: boolean }): Promise<{ lessons: number; newModules: string[]; errors: … }>`: có lỗi thì không ghi gì; `confirm=false` chỉ xem trước; `confirm=true` trong một giao dịch: tạo module chưa có (khớp tên sau khi bỏ khoảng trắng thừa, không phân biệt hoa thường; nếu khóa có hai module trùng tên đó → lỗi xem trước "Có hai module cùng tên …, đổi tên một cái trước"; module mới tạo theo thứ tự xuất hiện trong tệp), thêm các bài vào cuối khóa thành một phiên bản khóa mới (mã bài `${slug}-b<n>` như thêm bài trên web, `source_kind: "excel"`, mã chủ đề (nếu có) ghi vào `content.module_id` như bài nhập từ học liệu; chủ đề chưa có trong `courses.topics` thì thêm `{id, titleVi}` vào cuối; mã chủ đề phải dạng chữ hoa + số như `A1`, `B12`; mã mới mà thiếu "Tên chủ đề" → lỗi; cùng mã nhưng tên khác nhau trong tệp, hoặc khác tên đã có trong khóa → lỗi ghi rõ dòng; có tên mà không có mã → lỗi), xếp module, ghi nhật ký `lessons_import_excel` (số bài, module mới). Cùng quy tắc `stale` / `needs_confirm` / `busy` như `saveLesson`. Tệp > 2 MB → 413.
- Bộ nhập học liệu (`src/worker/content-import.ts`): mở rộng điều kiện giữ bài ở Task 2 từ `"web_editor"` sang `source_kind IN ("web_editor", "excel")`; test `tests/integration/excel-import.test.ts`: `nhập Excel 2 bài vào module 2, nhập lại content-mini.json: 2 bài Excel vẫn ở cuối khóa và vẫn ở module 2`.

- [ ] **Step 1: Test hỏng** `tests/unit/excel-import.test.ts` (dùng chính `src/assets/khung-bai-giang-mau.xlsx`): `đọc khung mẫu ra 2 bài mẫu đúng loại, ý chính tách theo dòng và dấu |`; `tiêu đề cột sai → lỗi dòng 1`; `tự luận thiếu đáp án → lỗi đúng số dòng`; `loại Video → lỗi chưa hỗ trợ`; `cùng mã chủ đề hai tên khác nhau → lỗi`; `mã chủ đề mới thiếu tên → lỗi`; `có tên chủ đề không có mã → lỗi`. `tests/integration/excel-import.test.ts`: `xem trước không ghi gì`; `xác nhận: thêm 2 bài cuối khóa, tạo module mới, nhật ký`; `có lỗi → không ghi gì`; `khóa có hai module trùng tên với tên trong tệp → lỗi xem trước`; `người hỗ trợ tải khung được, tải lên → 403`; `không phiên quản trị → 401`; `khung tải về là xlsx (PK…), Content-Disposition attachment`.
- [ ] **Step 2:** FAIL. **Step 3:** script dựng khung, `xlsx.ts`, `excel-import.ts`, routes, nút và màn xem trước (bảng lỗi theo dòng; nút "Thêm n bài" khi không lỗi). **Step 4:** PASS; mở khung bằng LibreOffice (`soffice --headless --convert-to pdf`) xem đúng tiếng Việt và cột; e2e `modules.mjs` thêm cảnh tải khung, tải lên khung mẫu, xác nhận, thấy 2 bài mới. **Step 5:** Codex, commit `feat(admin): Excel lesson template to download, fill and upload`.

### Task 6: Hoàn tất

- [ ] CLAUDE.md: mục module khóa học, loại bài, trang khóa cho người chưa mua, khung bài giảng Excel (`node scripts/build-lesson-template.mjs` để dựng lại); danh sách e2e thêm `modules`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` xanh; Codex; commit; đẩy GitLab + GitHub.
- [ ] Báo chủ; deploy chỉ khi chủ nói "deploy đi" (migration chỉ thêm bảng).
