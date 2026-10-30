# P3 — App học PWA, tải offline, giấy phép, đồng bộ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Học viên có quyền học mở khóa trên điện thoại (PWA), tải bài về máy để học khi tàu không có mạng, và tiến độ được đồng bộ an toàn khi có Starlink; máy chủ cấp giấy phép offline có chữ ký, kiểm quyền mọi tệp trả phí, nhận sự kiện học idempotent.

**Architecture:** Máy chủ: bảng media + tiến độ + sự kiện học (migration mới), module lưu tệp duy nhất (`storage`), API học (`/api/learn/**`) luôn kiểm phiên học viên + quyền theo nhóm gộp; giấy phép là JWS EdDSA ký bằng `node:crypto`. Client: service worker tự viết (không thư viện), IndexedDB theo `sub`+`did`, hàng chờ sự kiện; logic quyết định (hiệu lực giấy phép, xử lý kết quả đồng bộ, kiểm sha256) là hàm thuần có unit test.

**Tech Stack:** như P1/P2. Không thêm thư viện runtime. Ký Ed25519 bằng `crypto.sign(null, …)`.

**Spec:** `docs/technical-design-draft-2026-10-30.md` §6, §7, §3.3; `docs/design-gates-2026-10-30.md` §6, §7. Cổng G9 (giấy phép 30 + 7 ngày), G10 (thiết bị) còn **đề xuất** — dùng giá trị đề xuất, để trong hằng số có tên.

## Global Constraints

- Giấy phép: JWS compact, header `{ alg: 'EdDSA', kid, typ: 'JWT' }`; claims `v: 1`, `sub` (user id), `did` (device id), `courses: { id, versionId }[]`, `iat`, `exp = iat + 30 ngày`, `grace = 7 ngày` (giây). Khóa riêng từ `LICENSE_SIGNING_KEYS` (`kid:<PKCS8 DER base64>,…`) + `LICENSE_SIGNING_KID_CURRENT`; khóa công khai phát ở `GET /api/public/license-keys` (`{ keys: { kid, x }[] }`, `x` = raw 32 byte base64url).
- Hiệu lực trên máy: `t = max(giờ máy, mốc lớn nhất đã lưu)`; `t < exp` → `ok`; `exp ≤ t < exp + grace` → `grace` (học bài đã tải, banner yêu cầu kết nối); `t ≥ exp + grace` → `locked` (khóa nội dung trả phí). Bài học thử luôn mở.
- Tệp bảo vệ **chỉ** qua `GET /api/learn/files/:assetId`: phiên học viên → tra `media_assets` theo id (không lấy đường dẫn từ client) → quyền: tệp thuộc ít nhất một phiên bản bài nằm trong khóa người học có quyền (nhóm gộp) **hoặc** bài học thử → mở dưới `MEDIA_ROOT/protected/`, `realpath` phải nằm trong thư mục gốc, không theo symlink → stream, hỗ trợ `Range` (206/416), `Content-Type` từ DB, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, giới hạn 100 MB.
- Tệp media bất biến, tên theo sha256 (`<sha256>.<ext>`); ghi: tệp tạm cùng ổ → fsync → kiểm sha256 → đổi tên nguyên tử.
- Đồng bộ `POST /api/learn/sync`: thiết bị lấy **từ phiên**; tối đa 200 sự kiện/lô, body ≤ 256 KB; mỗi sự kiện trong savepoint; kết quả `accepted | duplicate | rejected | retryable`; duy nhất `event_id` và `(device_id, seq)`; khóa không còn quyền → lưu với `entitlement_ok = false`, không cập nhật tiến độ; tiến độ chỉ tăng; mỗi lần làm kiểm tra lưu một dòng `quiz_attempts`. Commit rồi mới trả kết quả + giấy phép mới. Sau mỗi lần đồng bộ thành công gọi `rotateIfDue(sessionId)` và đính cookie nếu xoay (review P1 M-1).
- Dữ liệu trên máy đặt tên theo `sub`+`did`; đăng xuất/đổi tài khoản/thiết bị bị thu hồi → xóa dữ liệu bảo vệ của người trước; đồng bộ trả khóa bị thu hồi → xóa dữ liệu khóa đó.
- Thiết bị: học viên xem và gỡ thiết bị của mình (cần xác thực gần đây); hỗ trợ gỡ hộ (`devices.remove`, audit).
- Văn bản tiếng Việt; giao diện theo màn `CadetCourse`, `CadetLesson`, `MyCourses`, `Account` của UI v1 ở mức chức năng (hoàn thiện thẩm mỹ ở P5).

## Review Focus

1. **Đồng hồ máy bị chỉnh lùi / mất mạng lâu trên tàu**: giấy phép không “sống lại” khi chỉnh giờ lùi; quá `exp + grace` thì khóa bài trả phí nhưng bài thử vẫn mở — Task 4 (hàm thuần), Task 7.
2. **Mạng chập chờn giữa lô đồng bộ** (request lỗi sau khi máy chủ đã commit, gửi lại cả lô): không nhân đôi sự kiện, tiến độ không lùi — Task 5.
3. **Hoàn tiền/thu hồi trong lúc máy offline**: lần đồng bộ tới không cấp khóa đó trong giấy phép, client xóa dữ liệu khóa đó; sự kiện cũ của khóa vẫn lưu `entitlement_ok = false` — Task 5, 7.
4. **Tải tệp dở dang / tệp hỏng** (đứt mạng, sha256 sai): không đánh dấu “đã tải xong”, tải lại được — Task 3, 7.
5. **Đường dẫn tệp độc hại** (asset id lạ, `../`, symlink trong thư mục media): không bao giờ đọc ngoài `MEDIA_ROOT/protected` — Task 2, 3.

---

## File Structure

```
prisma/migrations/<ts>_learning/migration.sql   # media_assets, lesson_version_assets, learning_events, learning_progress, quiz_attempts, sync_rejections
src/modules/storage/storage.ts                  # putFile, openProtected, publicPath — mọi truy cập đĩa đi qua đây
src/modules/learn/{entitlements,manifest,lessons,license,sync,progress,devices}.ts
src/worker/media-import.ts + lệnh `pnpm cli media:add`
src/app/api/learn/courses/[slug]/manifest/route.ts, src/app/api/learn/lessons/[lessonVersionId]/route.ts,
src/app/api/learn/files/[assetId]/route.ts, src/app/api/learn/sync/route.ts, src/app/api/public/license-keys/route.ts,
src/app/api/me/devices/route.ts, src/app/api/quan-tri/devices/route.ts
src/app/hoc/** (trang học), public/sw.js, src/app/manifest.ts
src/lib/offline/{license-state,sync-queue,downloads,db}.ts   # client; hàm thuần có unit test
```

---

### Task 1: Bảng học tập và media

**Files:** migration `…_learning`, `prisma/schema.prisma`. Test: `tests/integration/schema-learning.test.ts`.

**Interfaces:**
- `media_assets(id, sha256 CHECK ~ '^[0-9a-f]{64}$', mime, bytes CHECK > 0 AND ≤ 104857600, visibility CHECK IN ('public','protected'), storage_key UNIQUE, created_at)`; bất biến. `lesson_version_assets(lesson_version_id FK, media_asset_id FK, role CHECK IN ('audio','image','attachment'))` PK cặp; bất biến.
- `learning_events(id, event_id uuid UNIQUE, user_id FK, device_id FK, seq bigint CHECK ≥ 1, lesson_version_id FK NULL, course_id FK NULL, type CHECK IN ('lesson_opened','activity_completed','lesson_completed','quiz_attempt'), payload jsonb, payload_hash text, client_time timestamptz NULL, received_at, entitlement_ok bool)` UNIQUE `(device_id, seq)`; không UPDATE/DELETE.
- `learning_progress(user_id FK, lesson_id FK, status CHECK IN ('in_progress','completed'), completed_activities text[] DEFAULT '{}', best_score_pct int NULL CHECK 0–100, updated_at)` PK `(user_id, lesson_id)`; trigger: `status` không lùi từ `completed`, `best_score_pct` không giảm, `completed_activities` chỉ thêm (NEW ⊇ OLD).
- `quiz_attempts(id, event_id FK learning_events(event_id) UNIQUE, user_id, lesson_id, score_pct int 0–100, created_at)`; bất biến.
- `sync_rejections(id, user_id, device_id, event_id uuid, reason text, raw jsonb, created_at)`; chỉ thêm.
- Quyền `me_app`: SELECT/INSERT; UPDATE `learning_progress`; UPDATE cột `id` của `media_assets` để khóa dòng không cần.
- [ ] **Step 1: Test thất bại:** `completed → in_progress` → lỗi; `best_score_pct` 80 → 70 → lỗi; bỏ bớt `completed_activities` → lỗi; trùng `(device_id, seq)` → 23505; `learning_events` UPDATE → lỗi; `media_assets` bytes 0 → CHECK; `me_app` DELETE → 42501.
- [ ] **Step 2–4:** FAIL → cài đặt → PASS. **Step 5:** commit `feat(learn): learning, progress and media schema`.

### Task 2: Module lưu tệp và lệnh thêm media

**Files:** `src/modules/storage/storage.ts`, `src/worker/media-import.ts`, `src/worker/cli.ts`, `src/lib/env.ts` (`MEDIA_ROOT`, mặc định `./media`). Test: `tests/integration/storage.test.ts`.

**Interfaces:**
- `putFile(input: { bytes: Buffer; mime: string; visibility: 'public'|'protected' }): Promise<{ storageKey: string; sha256: string; bytes: number }>` — ghi `MEDIA_ROOT/<visibility>/<sha256>.<ext>` theo Global Constraints; tệp đã có cùng hash → không ghi lại.
- `openProtected(storageKey: string): Promise<{ handle: FileHandle; size: number } | null>` — `storageKey` phải khớp `^[0-9a-f]{64}\.[a-z0-9]{1,8}$`; `realpath` nằm trong `MEDIA_ROOT/protected`; từ chối symlink (`lstat`).
- CLI `pnpm cli media:add <externalLessonId> <tệp> --role audio [--public]`: chèn `media_assets` + `lesson_version_assets` cho **phiên bản hiện hành** của bài trong mọi khóa (dùng `pg`).
- [ ] **Step 1: Test thất bại:** ghi rồi đọc lại đúng nội dung và hash; ghi trùng không tạo tệp mới; `storageKey` `../x`, `a/b`, chữ hoa → null; symlink trỏ ra ngoài thư mục → null; ghi bị ngắt giữa chừng (giả lập lỗi trước rename) → không còn tệp đích.
- [ ] **Step 2–4.** **Step 5:** commit `feat(storage): content-addressed media storage`.

### Task 3: Quyền học, manifest, nội dung bài, tải tệp

**Files:** `src/modules/learn/{entitlements,manifest,lessons}.ts`, routes `api/learn/courses/[slug]/manifest`, `api/learn/lessons/[lessonVersionId]`, `api/learn/files/[assetId]`. Test: `tests/integration/learn-access.test.ts`.

**Interfaces:**
- `entitledCourses(userId): Promise<{ courseId; slug; versionId }[]>` (enrollment hiệu lực theo nhóm gộp, khóa `published` hoặc `archived`, phiên bản hiện hành).
- `courseManifest(ctx, slug): Promise<Manifest | 'forbidden' | 'not_found'>` với `Manifest = { courseId; slug; versionId; lessons: { position; lessonVersionId; externalId; title; contentHash; isFreeTrial }[]; assets: { assetId; lessonVersionId; role; mime; bytes; sha256 }[]; totalBytes }`.
- `lessonContent(ctx, lessonVersionId): Promise<{ content; contentHash } | 'forbidden' | 'not_found'>` — được khi bài thuộc khóa có quyền hoặc là bài học thử của khóa published.
- File route theo Global Constraints; `Range: bytes=a-b` → 206 + `Content-Range`; range sai → 416.
- [ ] **Step 1: Test thất bại:** chưa mua → manifest 403, nội dung bài trả phí 403, bài thử 200; sau khi đơn paid → 200 đủ 4 bài; hoàn tiền → 403 lại; tài khoản gộp đọc được khóa của tài khoản nguồn; tệp bảo vệ: không phiên → 401, phiên quản trị → 401, không quyền → 403, có quyền → 200 đúng byte, header đủ; `Range: bytes=0-9` → 206 10 byte; `bytes=999999-` → 416; asset id không phải uuid → 404.
- [ ] **Step 2–4.** **Step 5:** commit `feat(learn): entitlement-checked manifest, lessons and file streaming`.

### Task 4: Giấy phép offline

**Files:** `src/modules/learn/license.ts`, `src/lib/offline/license-state.ts`, route `api/public/license-keys`, `src/lib/env.ts`. Test: `tests/unit/license.test.ts`, `tests/unit/license-state.test.ts`.

**Interfaces:**
- `issueLicense(input: { userId; deviceId; courses: { id; versionId }[]; now?: Date; trustedKids?: string[] }): string` — ký bằng khóa hiện hành; nếu `trustedKids` có mà không chứa khóa hiện hành thì ký bằng khóa cũ nhất client tin (đổi khóa theo giai đoạn).
- `verifyLicense(token: string, publicKeys: { kid; x }[]): LicenseClaims | null` (dùng chung cho client: chỉ dùng WebCrypto-compatible API ở `src/lib/offline`, máy chủ dùng `node:crypto`).
- `licenseState(input: { exp: number; grace: number; deviceNow: number; maxSeen: number }): { state: 'ok' | 'grace' | 'locked'; maxSeen: number }` (giây).
- [ ] **Step 1: Test thất bại:** ký/xác minh vòng tròn; sửa 1 byte payload → null; `kid` lạ → null; `alg` khác `EdDSA` → null; `trustedKids=['k1']` khi hiện hành `k2` → ký bằng `k1`; `licenseState`: `t = exp − 1` ok, `t = exp` grace, `exp + grace` locked; giờ máy lùi 10 ngày sau khi đã thấy mốc lớn hơn → dùng mốc lớn nhất.
- [ ] **Step 2–4.** **Step 5:** commit `feat(learn): signed offline licence`.

### Task 5: Đồng bộ sự kiện học

**Files:** `src/modules/learn/{sync,progress}.ts`, route `api/learn/sync`. Test: `tests/integration/sync.test.ts`.

**Interfaces:**
- `type LearningEvent = { eventId: string; seq: number; type: 'lesson_opened'|'activity_completed'|'lesson_completed'|'quiz_attempt'; lessonVersionId: string; payload: Record<string, unknown>; clientTime?: string }` (payload: `activity_completed { activityId }`, `quiz_attempt { scorePct }`, `lesson_completed { scorePct? }`).
- `syncEvents(ctx: LearnerCtx, input: { events: unknown[]; trustedKids?: string[] }): Promise<{ results: { eventId: string | null; status: 'accepted'|'duplicate'|'rejected'|'retryable'; reason?: string }[]; license: string; courses: { id; slug; versionId }[]; revokedCourseIds: string[]; knownCourseIds?: string[] }>` — theo TD §6: một transaction, savepoint mỗi sự kiện, `payload_hash` = sha256 JSON chuẩn hóa để phân biệt `duplicate`/`rejected`.
- Route: body `{ events, trustedKids?, knownCourseIds? }`; `revokedCourseIds` = `knownCourseIds` − khóa hiện có quyền; sau commit gọi `rotateIfDue(ctx.sessionId)`, có token mới thì đính cookie phiên/CSRF.
- [ ] **Step 1: Test thất bại:** lô 3 sự kiện hợp lệ → 3 `accepted`, tiến độ `completed`; gửi lại cả lô → 3 `duplicate`, không dòng mới; cùng `eventId` khác payload → `rejected` + `sync_rejections`; `seq` đã dùng cho sự kiện khác → `rejected`; bài không tồn tại → `rejected`; sự kiện khóa đã hoàn tiền → `accepted`, `entitlement_ok=false`, tiến độ không đổi, `revokedCourseIds` chứa khóa; điểm 80 rồi 60 → `best_score_pct` 80, 2 dòng `quiz_attempts`; 201 sự kiện → 400; giấy phép trả về xác minh được và chỉ chứa khóa có quyền; token ≥ 7 ngày → cookie phiên mới trong phản hồi; hai lô song song cùng thiết bị → không 500, mỗi sự kiện đúng một kết quả.
- [ ] **Step 2–4.** **Step 5:** commit `feat(learn): idempotent learning sync with licence refresh`.

### Task 6: Thiết bị của tôi; chép tiến độ khi gộp

**Files:** `src/modules/learn/devices.ts`, routes `api/me/devices` (GET, DELETE `?id=`), `api/quan-tri/devices` (GET `?userId=`, DELETE). Modify: `src/modules/enrollments/merge.ts`. Test: `tests/integration/my-devices.test.ts`, bổ sung `access-merge.test.ts`.

**Interfaces:**
- `listMyDevices(ctx)`, `removeMyDevice(ctx, deviceId): Promise<'removed' | 'reauth_required' | 'not_found'>` (cần xác thực gần đây; gỡ chính máy đang dùng được và đăng xuất luôn); `adminRemoveDevice(ctx: AdminCtx, deviceId, reason)` (`devices.remove`, audit).
- Gộp tài khoản: chép `learning_progress` của nhóm nguồn sang đích theo giá trị cao nhất từng bài (trạng thái, điểm, hợp các hoạt động).
- [ ] **Step 1: Test thất bại:** liệt kê đúng máy của mình; gỡ máy khác → phiên máy đó null; xác thực cũ → `reauth_required`; gỡ máy người khác → `not_found`; support gỡ hộ → audit; gộp A (bài 1 completed 90%) vào B (bài 1 in_progress 50%) → B completed 90%.
- [ ] **Step 2–4.** **Step 5:** commit `feat(learn): device self-service and progress merge`.

### Task 7: App học PWA (client)

**Files:** `src/app/manifest.ts`, `public/sw.js`, `src/lib/offline/{db,sync-queue,downloads}.ts`, `src/app/hoc/page.tsx` (khóa của tôi), `src/app/hoc/[slug]/page.tsx` (danh sách bài, tải offline, dung lượng), `src/app/hoc/[slug]/[position]/page.tsx` (học bài: câu hỏi, từ vựng, câu trả lời mẫu, hoạt động, đánh dấu xong), `src/app/tai-khoan/page.tsx` (thiết bị, liên kết đăng nhập). Test: `tests/unit/sync-queue.test.ts`, `tests/unit/downloads.test.ts`.

**Interfaces:**
- `applySyncResults(queue: QueuedEvent[], results): { keep: QueuedEvent[]; quarantine: QueuedEvent[] }` — xóa `accepted`/`duplicate`, cách ly `rejected`, giữ `retryable` và sự kiện không có kết quả.
- `nextSeq(lastSeq: number): number`; `planDownloads(manifest, have: { assetId; sha256 }[]): { toFetch; totalBytes }`; `verifyAndStore(asset, bytes): Promise<'stored' | 'hash_mismatch'>` (SubtleCrypto sha256).
- Service worker: cache app shell (network-first cho HTML, cache-first cho `_next/static`), không cache phản hồi `/api/learn/files` hay `/api/learn/lessons` (client tự lưu vào IndexedDB theo `sub`+`did`); đăng xuất gửi message xóa dữ liệu.
- [ ] **Step 1: Test thất bại (unit):** `applySyncResults` cho đủ 4 trạng thái và lỗi cả request; `planDownloads` bỏ qua tệp đã có đúng hash, tải lại tệp sai hash; `verifyAndStore` hash sai → `hash_mismatch`.
- [ ] **Step 2–4.** **Step 5:** kiểm thử tay trên `next dev` bằng trình duyệt (Chrome DevTools offline): đăng nhập, mua khóa (đơn được xác nhận qua webhook giả có chữ ký), tải bài, tắt mạng, học, bật mạng, đồng bộ; ghi kết quả vào sổ. Commit `feat(pwa): offline learning app`.

### Task 8: Kiểm tra toàn bộ, tài liệu

- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → không lỗi. Cập nhật `CLAUDE.md` (biến `MEDIA_ROOT`, `LICENSE_SIGNING_*`, lệnh `media:add`), handoff, `PROGRESS.md`. Commit `docs: record p3 status`.

---

## Không nằm trong P3

Trợ lý AI 3D, chấm phát âm (để sau theo DG §10); audio thật (chưa có — lệnh `media:add` sẵn sàng); đổi khóa ký giấy phép theo giai đoạn ở phía vận hành (runbook P5); thông báo (P4); hoàn thiện giao diện theo v1 (P5).
