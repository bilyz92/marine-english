# Bài video (module khóa học, chặng 2/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module có thể chứa bài video, với cả hai nguồn chủ chọn ngày 08/11/2026 ("Cả hai"): (1) tệp video chủ tải lên máy chủ của mình, lưu dạng tệp bảo vệ, chỉ phát qua request có kiểm quyền (có Range để tua), tải về máy học offline được; (2) link YouTube (chỉ xem khi có mạng, mất mạng thì báo rõ). Người chưa mua không thấy video của bài trả phí; bài học thử (3 vị trí đầu) là video thì khách xem được.

**Architecture:** Loại bài thứ ba trong nội dung bài: `content.lesson_type = "video"` (cùng chỗ với `"essay"`, đi theo phiên bản bài và tải offline). Link YouTube lưu trong nội dung bài dưới dạng mã 11 ký tự `content.video.youtube_id` (máy chủ tự tách từ link chủ dán, không lưu link thô). Tệp video là một `media_assets` bảo vệ gắn vào phiên bản bài với `lesson_version_assets.role = 'video'` (như ghi âm role `audio`, nên tự đi theo bài sang phiên bản mới khi sửa bài — đã có trong `saveLesson`), mỗi phiên bản bài tối đa một tệp video (tải tệp mới thì thay). Tải lên là một route riêng, thân là bytes thô, ghi thẳng xuống đĩa theo luồng (không đệm cả tệp trong RAM), tính sha256 trong lúc ghi; route này không đi qua `src/proxy.ts` (proxy đệm thân, giới hạn 10 MB) và có location riêng ở nginx/Caddy. Phát: học viên dùng route có sẵn `/api/learn/files/[assetId]` (đã kiểm quyền + Range), khách học thử dùng route mới `/api/public/courses/[slug]/trial/[position]/video` chỉ trả tệp video của đúng bài học thử của khóa đang bán. Offline: video **không** tải cùng khóa; mỗi bài video có nút "Tải video về máy (n MB)", tải theo từng đoạn 4 MB bằng Range vào IndexedDB (đứt mạng thì tải tiếp từ đoạn còn thiếu), kiểm sha256 cộng dồn trước khi đánh dấu xong.

**Tech Stack:** Next.js 16 App Router (route handler đọc `req.body` dạng luồng), Prisma 7 raw SQL, PostgreSQL 16, Vitest, headless Chrome e2e, `@noble/hashes` (sha256 cộng dồn trong trình duyệt; WebCrypto chỉ băm một lần cả khối).

**Spec:** Quyết định của chủ 08/11/2026 trong `docs/superpowers/plans/2026-11-08-course-modules.md` (dòng Spec: "video (chặng 2: tải lên máy chủ có kiểm quyền và tải về học offline, hoặc link YouTube)") và chọn "Cả hai" nguồn. Ràng buộc từ CLAUDE.md: tệp trả phí chỉ tải qua request có kiểm quyền, không có URL công khai ổn định; trang khóa công khai chỉ gửi tên module, số bài và 3 bài học thử.

## Quyết định tạm (chủ duyệt sau)

Chủ chưa quyết các điểm dưới; plan chọn mặc định an toàn, đổi được sau mà không phải sửa dữ liệu:

1. **Dung lượng tối đa một tệp video: 300 MB** (khoảng 20–30 phút video 720p). Đặt ở một hằng số `MAX_VIDEO_BYTES` và khớp ở nginx/Caddy.
2. **Định dạng: mp4 / m4v và webm, kiểm theo vỏ tệp (container), không kiểm codec**, nhận diện theo byte đầu tệp, không tin đuôi tệp. mp4: hộp `ftyp` với nhãn chính nằm trong danh sách cho phép (`isom`, `iso2`, `iso4`, `iso5`, `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `M4VH`, `M4VP`, `dash`); mọi nhãn khác bị từ chối, gồm `.mov` của iPhone (`qt  `), tệp chỉ có tiếng (`M4A `, `M4B `, `M4P `), ảnh AVIF/HEIF (`avif`, `avis`, `heic`, `heix`, `mif1`, `msf1`), 3GP. webm: phần đầu EBML có DocType `webm`. Codec (H.264 hay HEVC) không kiểm được nếu không phân tích cả tệp: màn hình quản trị phát lại ngay sau khi tải lên để chủ thấy video xem được, và hướng dẫn chủ xuất "MP4 (H.264)". Không chuyển mã (transcode) trên máy chủ.
3. **Tải video về máy: nút riêng cho từng video, có hiện dung lượng**, không tự tải cùng "Tải khóa về máy" (tàu dùng Starlink theo gói dung lượng; một khóa có vài video là vài trăm MB). Có nút "Xóa video khỏi máy" để giải phóng bộ nhớ. Khóa đang mở tạm (chưa xác nhận tiền) không có nút tải, như quy tắc tải khóa hiện nay.
4. **Bài video có thể có cả tệp và link YouTube**: có tệp thì phát tệp (xem được khi mất mạng nếu đã tải), không có tệp thì nhúng YouTube. Bài video chưa có cả hai thì học viên thấy "Bài này chưa có video".
5. **Nhúng YouTube qua `youtube-nocookie.com`** (không đặt cookie theo dõi trước khi bấm phát). Chỉ lưu mã video, không lưu link thô.
6. **Bài video không bắt buộc đáp án mẫu**; form bài video có: tiêu đề (tiếng Anh bắt buộc, tiếng Việt), link YouTube, ý chính, từ vựng. Ẩn đáp án mẫu và câu hỏi phụ (không xóa dữ liệu cũ nếu đổi loại bài).
7. **Excel giữ nguyên**: dòng "Video" vẫn báo "Loại bài chưa hỗ trợ" (thêm video bằng form web).
8. Thời gian chờ tải lên ở nginx: 15 phút (300 MB qua mạng bờ 3 Mbps ≈ 14 phút); nginx không đệm thân (`proxy_request_buffering off`) để app ghi xuống đĩa ngay.

## Global Constraints

- Không đổi mã băm của bài hỏi–đáp và tự luận đang có: chỉ bài video ghi `lesson_type: "video"` và `video`; đổi bài video sang loại khác thì xóa `video` và `lesson_type` như hiện nay.
- Tệp video luôn `visibility = 'protected'`; không bao giờ ghi vào `MEDIA_ROOT/public`; đường dẫn tệp luôn tra từ DB theo id, không lấy từ client. Chỉ một đường tạo được tệp video: route tải lên (kiểm byte đầu, bảo vệ). Bảng MIME chung `EXT_BY_MIME`/`MIME_BY_EXT` (dùng bởi `putFileAt` và CLI `media:add`) **không** thêm video: `putStreamAt` có bảng đuôi riêng. CLI `media:add` từ chối `--role video` và đuôi video. Ràng buộc DB chặn thêm: `media_assets` không có dòng `mime LIKE 'video/%'` mà `visibility = 'public'`.
- API công khai `/api/public/courses/[slug]` và trang `/khoa-hoc/[slug]` không gửi mã YouTube, mã tệp hay tiêu đề của bài video không phải học thử (giữ đúng cấu trúc Task 7 chặng 1; thêm test).
- Quyền: xem danh sách video của bài = `orders.view`; tải lên/gỡ = `content.edit` (chủ); ghi `admin_audit_log` (`lesson_video_set`, `lesson_video_remove`).
- Tải lên theo luồng: không `req.arrayBuffer()`, không `formData()`; vượt 300 MB giữa chừng → dừng, xóa tệp tạm, 413; phần đầu không phải video hợp lệ → xóa tệp tạm, 400.
- Chữ giao diện tiếng Việt, gọi học viên là "bạn"; màu chỉ từ `src/app/tokens.css`; chữ ≥ 15px.

## Review Focus

1. Người chưa mua (khách hoặc học viên khác khóa) không lấy được tệp video trả phí: `/api/learn/files/<id>` → 403, route học thử với vị trí không phải học thử → 404, API/HTML trang khóa không chứa mã YouTube hay mã tệp của bài trả phí (Task 2, Task 6).
2. Tải lên 300 MB không làm phồng RAM của app; tệp quá lớn hoặc sai định dạng không để lại tệp tạm (Task 1). Không đường nào khác (CLI `media:add`, bảng MIME chung) tạo được tệp video hay tệp video công khai (Task 2).
3. Range: `bytes=0-` → 206 đủ tệp; `bytes=100-199` → 206 đúng 100 byte; ngoài kích thước → 416 (Task 2, đã có `fileResponse`, thêm test cho video và route học thử).
4. Tải video về máy đứt giữa chừng → lần sau tải tiếp phần thiếu; sai sha256 → không đánh dấu xong, xóa các đoạn (Task 3).
5. Khóa bị thu hồi / đăng xuất / video bị thay → video đã tải bị xóa khỏi máy (Task 3, `pruneVideos` theo manifest còn lưu; đăng xuất xóa cả DB).
6. Proxy matcher: route tải lên video không qua proxy, nhưng handler vẫn kiểm phiên, Origin, CSRF, quyền (Task 2, test 401/403).

---

## File Structure

- Modify `src/modules/storage/files.ts`: thêm `putStreamAt` (ghi luồng, băm, giới hạn kích thước, kiểm đầu tệp), MIME `video/mp4` → `mp4`, `video/webm` → `webm`.
- Modify `src/modules/storage/storage.ts`: `putStream` bọc `putStreamAt` với `MEDIA_ROOT`.
- Create `src/modules/content/video-format.ts` (thuần, không import máy chủ, trình duyệt dùng được): `MAX_VIDEO_BYTES`, `sniffVideo`, `parseYouTubeId`.
- Create `src/modules/content/lesson-video.ts` (máy chủ): `listLessonVideo`, `setLessonVideo`, `removeLessonVideo`, `trialVideo`.
- Create `src/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/video/route.ts` (GET, POST thân thô, DELETE).
- Create `src/app/api/public/courses/[slug]/trial/[position]/video/route.ts` (GET, Range).
- Modify `src/proxy.ts` (matcher bỏ route tải lên video), `src/modules/content/editor.ts` (`lessonType` thêm `"video"`, `youtubeUrl`), `src/modules/learn/manifest.ts` + `src/lib/offline/engine.ts` (kiểu `lessonType` thêm `"video"`), `src/lib/offline/downloads.ts` (bỏ role `video` khỏi tải khóa).
- Create `src/lib/offline/video-download.ts`: tải từng đoạn Range + sha256 cộng dồn (hàm thuần, nhận hàm đọc/ghi kho để test).
- Modify `src/lib/offline/db.ts` (phiên bản 2: kho `videos`, `videoParts`), `src/lib/offline/engine.ts`: `videoState`, `downloadVideo`, `deleteVideo`, `videoBlob`, `pruneVideos` (gọi sau `loadManifest` và trong `removeCourseData`).
- Modify `src/worker/media-import.ts` / `src/worker/cli.ts`: `media:add` từ chối role video.
- Create `src/components/study/video-lesson.tsx`; modify `src/app/hoc/lesson-view.tsx`, `src/app/hoc/course-view.tsx` (nhãn "Video"), trang học thử.
- Admin: modify `course-lessons.tsx` (loại "Video", ô link YouTube, nút "Video" từng bài), create `lesson-video.tsx` (tải lên có thanh tiến độ bằng XHR, xem lại qua `/api/quan-tri/audio/[id]` — route này đã phát mọi tệp đang gắn vào một bài, có Range).
- Deploy: `deploy/nginx-marine-english.conf`, `deploy/Caddyfile`, `docs/runbook.md`.
- Tests: `tests/unit/storage-stream.test.ts`, `tests/unit/video-format.test.ts`, `tests/unit/video-download.test.ts`, bổ sung `tests/unit/downloads.test.ts` (hoặc file đang test `planDownloads`), `tests/integration/lesson-video.test.ts`, bổ sung `content-editor.test.ts`, `catalog.test.ts`; e2e `tests/e2e-ui/video.mjs`.

---

### Task 1: Ghi tệp theo luồng và nhận diện video

**Interfaces — Produces:**
- `putStreamAt(root, input: { stream: ReadableStream<Uint8Array>; visibility: Visibility; maxBytes: number; sniff: (head: Buffer) => string | null /* mime hoặc null */; headBytes?: number /* mặc định 4096 */ }): Promise<{ storageKey; sha256; bytes; mime }>` — ghi vào tệp tạm `.tmp-*` cùng thư mục, cộng dồn sha256, đếm byte; vượt `maxBytes` → `StreamTooLarge`; `sniff` (gọi một lần khi đủ `headBytes` hoặc hết luồng) trả null → `StreamRejected`; rỗng → `StreamRejected`; fsync, đổi tên nguyên tử thành `<sha256>.<ext>`; đã có tệp cùng tên: kiểm kích thước bằng nhau (băm lại theo luồng) rồi xóa tệp tạm. Mọi lỗi đều xóa tệp tạm.
- `sniffVideo(head: Buffer): "video/mp4" | "video/webm" | null` — `ftyp` tại byte 4..8 với nhãn chính trong danh sách cho phép (Quyết định tạm 2) → mp4; `1A 45 DF A3` và chuỗi `webm` trong 64 byte đầu → webm.
- `putStreamAt` chỉ nhận MIME có trong bảng đuôi riêng của nó (`video/mp4` → `mp4`, `video/webm` → `webm`); `EXT_BY_MIME` chung giữ nguyên.
- `parseYouTubeId(url: string): string | null` — nhận `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/embed/`, `youtube.com/shorts/`, `m.youtube.com`, `youtube-nocookie.com/embed/`; mã đúng `^[A-Za-z0-9_-]{11}$`; host khác → null.

- [ ] **Step 1: Test hỏng** `tests/unit/storage-stream.test.ts` (thư mục tạm): ghi luồng nhiều khúc → tệp `<sha>.mp4` đúng nội dung, sha256 bằng `createHash`; vượt `maxBytes` → lỗi, thư mục không còn `.tmp-*`; `sniff` null → lỗi, không còn tệp tạm; ghi lại cùng nội dung → cùng khóa, không lỗi. `tests/unit/video-format.test.ts`: `sniffVideo` cho mp4 (`isom`, `mp42`, `avc1`), m4v (`M4V `), webm; null cho mkv (`matroska`), mov (`qt  `), m4a/m4b/m4p, avif, heic, mif1, 3gp4, mp3, rác; `parseYouTubeId` cho các dạng link trên, link host lạ, mã sai độ dài.
- [ ] **Step 2:** `pnpm vitest run --project unit tests/unit/storage-stream.test.ts tests/unit/video-format.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt (`sniffVideo`, `parseYouTubeId`, `MAX_VIDEO_BYTES` thuần trong `src/modules/content/video-format.ts`; `lesson-video.ts` import lại).
- [ ] **Step 4:** PASS; lint, typecheck. (Commit cùng Task 2: bảng đuôi video và `putStreamAt` chưa có người gọi.)

### Task 2: Máy chủ: loại bài video, tải lên, phát, học thử

**Interfaces — Produces:**
- `LessonFields.lessonType: z.enum(["qa", "essay", "video"])`, `youtubeUrl: z.string().trim().max(500).optional().default("")`. `applyFields`: `video` → `lesson_type: "video"`, có link → `video: { youtube_id }`, không có → xóa `video`; loại khác → xóa `lesson_type` (trừ essay) và `video`. `saveLesson`: `video` mà `youtubeUrl` không tách được mã → `HttpError(400, "youtube_invalid")`; bài video không cần đáp án mẫu. `lessonTypeOf` trả thêm `"video"`.
- `courseLessons` mỗi bài thêm `hasVideo: boolean` (có tệp video hoặc mã YouTube) — để trang quản trị nhắc "chưa có video".
- `listLessonVideo(ctx, slug, externalId): Promise<{ id; mime; bytes; createdAt }[]>` (`orders.view`).
- `setLessonVideo(ctx, slug, externalId, stream, declaredBytes): Promise<{ id: string }>` (`content.edit`): bài phải có trong phiên bản hiện tại và là bài video (khác → 400 `not_video_lesson`); ghi luồng (Task 1) trước giao dịch; trong giao dịch (cùng khóa `content-import`) **kiểm lại** sau khi khóa: tra phiên bản bài hiện hành của bài trong khóa (có thể đã khác lúc bắt đầu tải vì chủ sửa bài trong lúc tải) và nội dung của nó vẫn là `lesson_type = "video"`; bài không còn → 404, không còn là bài video → 400 `not_video_lesson` (tệp đã ghi ở lại trên đĩa như tệp mồ côi, xem "Tệp cũ" dưới). Rồi thêm `media_assets` (bảo vệ), xóa liên kết `role='video'` cũ của phiên bản bài hiện hành, thêm liên kết mới; nhật ký `lesson_video_set` (before: asset cũ, after: asset mới, bytes, mime).
- **Tệp cũ (giữ, không xóa tự động ở chặng này):** thay/gỡ video chỉ xóa liên kết; dòng `media_assets` bất biến (trigger `forbid_mutation`, như ghi âm) và tệp trên đĩa ở lại; tải lên rồi lỗi DB cũng để lại tệp. Lý do: phiên bản bài cũ (lịch sử, máy học viên đang giữ manifest cũ) vẫn có thể trỏ tới tệp; xóa an toàn cần một job dọn có kiểm tham chiếu, ngoài phạm vi. Bù lại: runbook có câu SQL liệt kê tệp video không còn gắn vào phiên bản bài hiện hành nào và tổng dung lượng, cùng lệnh `du` thư mục `MEDIA_ROOT/protected`; ghi `shortcut:` tại `setLessonVideo`.
- `planDownloads` bỏ qua `role === "video"` **ngay trong Task 2** (cùng commit với việc manifest bắt đầu có tệp video), để không bản build nào tự tải cả video khi tải khóa.
- CLI `media:add`: chỉ nhận `--role audio|image|attachment` (vai khác → lỗi, mã thoát 1), đuôi tệp chỉ theo `MIME_BY_EXT` chung (không có video).
- `removeLessonVideo(ctx, slug, externalId, assetId)`: xóa liên kết, nhật ký `lesson_video_remove`; không có → 404.
- `trialVideo(slug, position): Promise<{ storageKey; mime } | null>`: chỉ khi khóa `published`, vị trí là `is_free_trial` của phiên bản hiện hành, và tệp gắn `role='video'` vào đúng phiên bản bài đó.
- Route `POST /api/quan-tri/content/courses/[slug]/lessons/[externalId]/video`: `requireAdmin` (phiên, Origin, CSRF), quyền, `content-length` bắt buộc (thiếu → 411, > 300 MB → 413), đọc `req.body` theo luồng. `GET` (danh sách), `DELETE ?asset=<uuid>`.
- Route `GET /api/public/courses/[slug]/trial/[position]/video` → `fileResponse` (Range), không có → 404.
- `src/proxy.ts` matcher: thêm `api/quan-tri/content/courses/[^/]+/lessons/[^/]+/video$` vào phần loại trừ (như route nhập gói); GET/DELETE của cùng đường dẫn cũng không qua proxy, handler tự kiểm phiên nên vẫn an toàn.
- Manifest: `lessonType: "qa" | "essay" | "video"`; tệp video có trong `assets` (role `video`, url `/api/learn/files/<id>`) như mọi tệp bảo vệ.

- [ ] **Step 1: Test hỏng** `tests/integration/lesson-video.test.ts` (mẫu theo `lesson-audio.test.ts`):
  - `chủ thêm bài video có link YouTube: nội dung có lesson_type video và youtube_id; link sai → 400 youtube_invalid; bài video không cần đáp án mẫu`.
  - `chủ tải video mp4 (thân thô) lên bài video: tệp bảo vệ, role video, nhật ký; tải tệp khác → thay, vẫn 1 tệp; gỡ → 0 tệp`.
  - `tải video lên bài không phải video → 400; tệp không phải video → 400 và không có tệp tạm trong MEDIA_ROOT; thiếu content-length → 411; khai > 300 MB → 413`.
  - `người hỗ trợ xem được danh sách, tải lên → 403; không phiên → 401; thiếu CSRF → 403`.
  - `sửa nội dung bài video: tệp video đi theo phiên bản mới`.
  - `học viên có quyền: /api/learn/files/<video> Range bytes=0-9 → 206, content-range đúng; học viên không mua → 403`.
  - `học thử: khóa đang bán, bài video ở vị trí 1 → route học thử trả 206 với Range; vị trí 4 (không học thử) → 404; khóa nháp → 404`.
  - `manifest: lessonType video, asset role video`.
  - `đổi loại bài trong lúc đang tải lên: luồng tải dừng giữa chừng, chủ đổi bài sang hỏi–đáp, luồng xong → 400 not_video_lesson, không có liên kết video`.
  - `ràng buộc DB: role video nhận; tệp 300 MB nhận, 300 MB + 1 bị từ chối; mime video/* với visibility public bị từ chối`.
  - `media:add` (`tests/integration/media-import.test.ts` hoặc file đang test `addMedia`): role video → lỗi; tệp `.mp4` → lỗi đuôi không hỗ trợ.
  - `tests/unit/downloads.test.ts` (hoặc file đang test `planDownloads`): tệp role video không có trong danh sách tải, `complete` không phụ thuộc video.
  - `catalog.test.ts`: `API công khai và getPublishedCourse không chứa mã YouTube hay mã tệp của bài video không học thử`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS + `pnpm test` toàn bộ. **Step 5:** `/codex-impl-review`, commit `feat(content): video lessons: protected uploads streamed to disk, YouTube links, trial playback`.

### Task 3: Offline: video không tải cùng khóa, tải riêng từng video

**Kho trên máy:** IndexedDB lên phiên bản 2, thêm hai kho riêng (không dùng kho `files`, vì `downloadPlan` đọc `getAll` cả kho `files` vào bộ nhớ): `videos` (khóa `assetId`, bản ghi nhỏ `{ assetId, sha256, mime, bytes, parts, done: boolean }`) và `videoParts` (khóa `<assetId>#<n>`, giá trị là `Blob` 4 MB — trình duyệt giữ Blob trên đĩa, không trong RAM). `onupgradeneeded` tạo kho còn thiếu, giữ dữ liệu cũ.

**Interfaces — Produces:**
- `src/lib/offline/video-download.ts` (thuần, test được):
  - `checkRangeResponse(res: { status: number; contentRange: string | null; length: number }, want: { start: number; end: number; size: number }): boolean` — chỉ đúng khi `status === 206`, `Content-Range` đúng dạng `bytes <start>-<end>/<size>` khớp đúng khoảng xin và đúng tổng kích thước trong manifest, và số byte nhận được bằng `end - start + 1`. `200` (máy chủ bỏ Range), `416`, `Content-Range` sai dạng hay lệch, thiếu byte → sai → `failed`.
  - `downloadInChunks(opts: { size; sha256; chunkBytes?: number /* 4 MB */; fetchRange(start, end): Promise<Uint8Array | null /* null = phản hồi không hợp lệ */>; getPart(n): Promise<Uint8Array | undefined>; putPart(n, bytes): Promise<boolean /* false = video không còn được giữ */>; finish(): Promise<boolean>; deleteParts(count): Promise<void>; onProgress? }): Promise<"done" | "failed" | "hash_mismatch" | "cancelled">` — đoạn đã có thì đọc lại để băm (không tải lại), thiếu thì tải bằng Range; băm cộng dồn bằng `@noble/hashes/sha2` `sha256.create()`; hết đoạn mà sha256 khác → xóa mọi đoạn, `hash_mismatch`; lỗi mạng hoặc phản hồi không hợp lệ → `failed`, giữ đoạn đã có; `putPart` hay `finish` trả false → dừng ngay, xóa mọi đoạn, `cancelled`.
  - **Phối hợp với dọn video:** trong engine, `putPart` và `finish` mỗi cái là **một giao dịch IndexedDB readwrite** trên `kv` + `videos` + `videoParts`: đọc `manifests` trong `kv`, chỉ ghi khi mã tệp còn trong một manifest đang lưu (cùng điều kiện với `staleVideoIds`), không thì không ghi gì và trả false. `pruneVideos` (và việc lưu manifest mới / `removeCourseData`) cũng chạy trong giao dịch readwrite có `kv`; IndexedDB xếp các giao dịch readwrite chồng phạm vi nối tiếp nhau, nên một lần tải đang chạy không thể ghi lại đoạn hay bản ghi xong sau khi video đã bị dọn. Đoạn đang tải dở của video bị dọn sẽ bị ghi bỏ (cancelled) và xóa.
  - `staleVideoIds(stored: string[], manifests: { assets: { assetId: string; role: string }[] }[]): string[]` — video trên máy không còn nằm trong manifest nào đang lưu (thay video, thu hồi khóa, video dùng chung ở khóa khác vẫn giữ).
- `engine.ts`: `videoState(identity, asset): Promise<"none" | "partial" | "done">`, `downloadVideo(identity, asset, onProgress)` (bọc `fetch` với header `Range`, kiểm bằng `checkRangeResponse`), `deleteVideo(identity, asset)`, `videoBlob(identity, asset): Promise<Blob | null>` (đã tải xong → `new Blob(parts, { type })` ghép từ các Blob đoạn, không chép vào RAM; chưa → null). **Dọn video cũ:** sau mỗi lần `loadManifest` lưu manifest mới và cuối `removeCourseData`, gọi `pruneVideos(db)` xóa mọi video mà `staleVideoIds` trả về (bản ghi `videos` và mọi đoạn `videoParts`). Đăng xuất / đổi người / phiên hết hạn đã xóa cả DB (`deleteOfflineDb`) nên video đi theo.
- **URL `blob:`:** component phát video (Task 4) là chủ duy nhất của URL: tạo bằng `URL.createObjectURL` trong effect, `URL.revokeObjectURL` khi đổi bài, đổi nguồn, effect bị hủy (kể cả lần tải bất đồng bộ đã cũ) và khi rời trang. Engine chỉ trả `Blob`, không tạo URL.

- [ ] **Step 1: Test hỏng** `tests/unit/video-download.test.ts`: tải đủ từ đầu (3 đoạn, sha đúng → done, gọi Range đúng các khoảng); đứt ở đoạn 2 → failed, lần sau chỉ tải đoạn 2–3; sai sha → hash_mismatch và các đoạn bị xóa; phản hồi không hợp lệ (null) → failed; tải dừng ở đoạn 2 (fetchRange chờ), manifest đổi / khóa bị thu hồi rồi dọn video, tải chạy tiếp → `putPart` trả false → `cancelled`, không còn đoạn hay bản ghi xong nào (kho giả trong test mô phỏng điều kiện "còn trong manifest" giống engine). `checkRangeResponse`: 206 đúng → true; 200, 416, `Content-Range` sai dạng, sai khoảng, sai tổng kích thước, thiếu byte → false. `staleVideoIds`: video bị thay (manifest mới không còn mã cũ) → bị dọn; khóa bị thu hồi (manifest không còn) → bị dọn; video dùng chung với khóa khác còn lưu → giữ.
- [ ] **Step 2:** FAIL. **Step 3:** `pnpm add @noble/hashes`, cài đặt. **Step 4:** PASS. Hành vi IndexedDB thật (lên phiên bản 2, dọn khi thu hồi) kiểm trong e2e Task 6.

### Task 4: Giao diện học viên và học thử

**Interfaces — Produces:** `VideoLesson({ externalId, content, video, youtubeOnline?, children })` trong `src/components/study/video-lesson.tsx`, `video: { src: string | null; download?: ReactNode }`. Hiện tiêu đề (EN/VI), trình phát: có `src` → `<video controls playsInline preload="metadata">`; không có mà có `youtube_id` → khi có mạng iframe `https://www.youtube-nocookie.com/embed/<id>` (`allow` tối thiểu, `title`), mất mạng → "Video YouTube cần có mạng để xem. Khi có mạng, mở lại bài này."; không có gì → "Bài này chưa có video.". Lỗi phát tệp (mất mạng, chưa tải) → "Chưa xem được video: video chưa tải về máy và máy đang mất mạng." Ý chính, từ vựng bên dưới.
- `lesson-view.tsx`: `lesson_type === "video"` → `VideoLesson`; nguồn phát: `videoBlob` có → URL `blob:` do component tạo và thu hồi (Task 3), không → `asset.url`; khối tải: "Tải video về máy (n MB)" (ẩn khi `manifest.provisional`), thanh tiến độ, "Đã tải video về máy · Xóa khỏi máy", lỗi tải theo `DOWNLOAD_ERROR`.
- Trang học thử: `VideoLesson` với `src = /api/public/courses/<slug>/trial/<position>/video` khi có tệp (máy chủ biết có tệp qua `trialVideo`), không có nút tải.
- `course-view.tsx`: nhãn "Video" cạnh bài video (như "Tự luận").

- [ ] **Step 1:** e2e `tests/e2e-ui/video.mjs` phần học viên viết trước (xem Task 6). **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS, `PAGE_CHECKS` ở 360/390 không lỗi.

### Task 5: Trang quản trị

- Form bài: "Loại bài" thêm "Video"; với video: nhãn "Tiêu đề video · tiếng Anh *" / "· tiếng Việt", ô "Link YouTube (không bắt buộc nếu tải tệp video lên)", ẩn đáp án mẫu và câu hỏi phụ, dòng giải thích "Lưu bài xong, bấm nút Video ở dòng bài để tải tệp video (mp4/webm, tối đa 300 MB)".
- Dòng bài: nhãn "Video", "chưa có video" khi `!hasVideo`; nút "Video" (chỉ bài video) mở `LessonVideo`: xem lại (`<video controls preload="none" src="/api/quan-tri/audio/<id>">`), dung lượng, Gỡ; chọn tệp → kiểm kích thước phía trình duyệt, tải lên bằng `XMLHttpRequest` (thân là tệp, header CSRF) có phần trăm tiến độ; 413 → "Tệp lớn hơn 300 MB".
- [ ] e2e phần quản trị trong `video.mjs`; PASS.

### Task 6: Hạ tầng, e2e, tài liệu

- nginx: `location ~ ^/api/quan-tri/content/courses/[^/]+/lessons/[^/]+/video$ { client_max_body_size 300m; proxy_request_buffering off; client_body_timeout 120s; proxy_read_timeout 900s; proxy_send_timeout 900s; … }`. Kiểm bằng `nginx -t` trong container `nginx:1.27-alpine` (chứng chỉ giả).
- Caddy: matcher `@videoUpload path_regexp ^/api/quan-tri/content/courses/[^/]+/lessons/[^/]+/video$` với `max_size 300MiB`, `@other` loại trừ cả nó. Kiểm bằng `caddy validate` trong container `caddy:2.10-alpine`.
- `docs/runbook.md`: mục video (giới hạn, định dạng, cấu hình nginx cần áp lên máy chủ, dung lượng đĩa: video nằm trong `MEDIA_ROOT/protected` và được sao lưu cùng media).
- e2e `tests/e2e-ui/video.mjs` (bản build thật): chủ tạo khóa, bài 1 video tải tệp mp4 nhỏ do ffmpeg dựng (kèm một hộp `free` để tệp > 10 MB, chứng minh route không qua proxy 10 MB), bài 2 video YouTube, bài 4 video có tệp + YouTube (không học thử), mở bán; khách xem học thử bài 1 (phần tử video phát được: `readyState ≥ 1`, Range 206); HTML trang khóa và API công khai không chứa mã YouTube/mã tệp bài 4; học viên có cấp không thu tiền mở bài 4: `fetch` Range → 206, phần tử video có `duration > 0`; bấm "Tải video về máy" → "Đã tải video về máy"; tắt mạng, tải lại bài → video phát từ `blob:`; bài YouTube khi mất mạng hiện câu báo cần mạng; học viên khác không mua: `/api/learn/files/<id>` → 403.
- CLAUDE.md: đoạn module khóa học (video), danh sách e2e thêm `video`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; e2e video + modules; Codex; commit.

## Ghi chú triển khai

- **Ranh giới commit:** Task 1 + Task 2 một commit (manifest có video và tải khóa bỏ video cùng lúc). Không deploy giữa chừng: chỉ deploy khi xong Task 6 (giao diện học viên của Task 4 cần có trước khi bài video tới tay học viên).

- **Có migration mới** `prisma/migrations/20261112090000_lesson_video/migration.sql` (Task 2): `lesson_version_assets.role` đang có CHECK `IN ('audio','image','attachment')` → thêm `'video'`; `media_assets.bytes` đang có CHECK `<= 104857600` (100 MB) → nâng lên `<= 314572800` (300 MB); thêm CHECK `media_assets_video_protected` (`mime NOT LIKE 'video/%' OR visibility = 'protected'`). Chỉ nới ràng buộc (DROP CONSTRAINT + ADD CONSTRAINT, dữ liệu cũ vẫn thỏa), không đụng dữ liệu. Test `tests/integration/lesson-video.test.ts` có ca chèn tệp 300 MB khai báo (chỉ dòng DB) qua `me_app` thành công và 300 MB + 1 bị từ chối. `MAX_MEDIA_BYTES` của `putFileAt` (đệm trong RAM) giữ 100 MB; video chỉ đi qua `putStreamAt`.
- Production: phải áp cấu hình nginx mới (location video) trước khi chủ tải video > 5 MB; ổ đĩa máy chủ cần đủ chỗ cho video và bản sao lưu.
