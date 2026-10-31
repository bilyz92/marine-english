# P4 — Worker, outbox, job định kỳ, cảnh báo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một tiến trình worker chạy cạnh app (cùng Docker Compose ở P5) làm mọi việc nền: gửi thông báo từ outbox (Telegram cho kinh doanh, email cho học viên), hết hạn đơn, dọn phiên, hết hạn lời mời quản trị, giải phóng thiết bị quá hạn, tổng kết 21:00, đối soát SePay (khi có API), có lease chống chạy chồng, nhật ký từng lần chạy, nút “chạy ngay” trên trang quản trị và cảnh báo lỗi.

**Architecture:** Bảng `job_leases` (lease có token + generation, fencing cho tác dụng không lặp lại được), `job_runs`, `job_requests`; outbox nhận lô bằng `FOR UPDATE SKIP LOCKED` với claim token. Job là hàm thuần trên DB, test bằng Postgres thật; worker chỉ là vòng lặp lịch gọi các hàm đó. Worker chạy bằng Node 24 (`--experimental-transform-types`) với một loader nhỏ ánh xạ `@/` → `src/`, không cần bước build.

**Tech Stack:** như P1–P3. Không thêm thư viện: lịch tự viết (mỗi job có `nextRun(now)`), Telegram Bot API qua `fetch`.

**Spec:** `docs/technical-design-draft-2026-10-30.md` §8 + §8.1; `docs/design-gates-2026-10-30.md` §2.6, §2.7, §8; CLAUDE.md (Notifications, Scheduled jobs, “notification failure must never roll back the unlock”). Cổng: G4 (API đối soát SePay), G7 (email), G8 (VPS/sao lưu — P5), G9/G10 (giải phóng thiết bị), G12a (xóa dữ liệu quá hạn — chưa có dữ liệu ghi âm, để sau).

## Global Constraints

- Múi giờ lịch: `Asia/Ho_Chi_Minh`, ghi cạnh mỗi lịch. Tên job có namespace `me.*`.
- Lease: hạn 2 phút, heartbeat 30 giây; mất lease → dừng job (AbortController). Lấy lease khi đang có người giữ → `job_runs.status = 'skipped'`.
- Fencing: mọi transaction có tác dụng không lặp lại được bắt đầu bằng `SELECT … FROM job_leases WHERE job_name = $1 FOR UPDATE` và kiểm token, generation, `expires_at > now()`; sai → rollback, dừng.
- Outbox: nhận lô `(pending AND next_attempt_at <= now()) OR (sending AND claimed_until < now())` bằng `FOR UPDATE SKIP LOCKED`, đặt `sending`, `claim_token` mới, `claimed_until = now() + 2 phút`, `attempts + 1`, commit, gửi, rồi `sent` có điều kiện `claim_token`. Lỗi → `pending` với giãn cách `min(2^attempts × 30 giây, 1 giờ)`; quá 8 lần → `dead` + cảnh báo nhóm lỗi. Giao hàng ít nhất một lần.
- Gửi thông báo lỗi không bao giờ đụng tới đơn hay quyền học.
- Không có endpoint HTTP chạy job; “chạy ngay” chỉ ghi `job_requests` (quyền `jobs.run`, có audit).
- Bí mật Telegram từ env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BUSINESS_CHAT_ID`, `TELEGRAM_ERROR_CHAT_ID`), thiếu thì kênh Telegram coi như chưa cấu hình: tin vẫn nằm `pending` với `last_error = 'not_configured'`, không đánh dấu `dead`. Email: `emailSender()` của P1 (production chưa có G7 → báo lỗi gửi).
- Văn bản tin nhắn tiếng Việt, không chứa mã OTP, token, nội dung chuyển khoản đầy đủ hay số tài khoản.

## Review Focus

1. **Hai worker cùng chạy** (deploy chồng, worker cũ treo rồi sống lại): một job không chạy hai lần cùng lúc; worker cũ mất lease không ghi được tác dụng — Task 2.
2. **Tiến trình gửi chết giữa chừng**: tin `sending` được lấy lại sau khi claim hết hạn; không có tin bị kẹt mãi — Task 3.
3. **Telegram/email lỗi kéo dài** (mất mạng VPS, token sai): tin không bị mất, không spam, quyền học không bị ảnh hưởng — Task 3, 4.
4. **Tổng kết 21:00 khi worker khởi động lại lúc 21:05 hoặc chạy hai lần**: gửi đúng một lần mỗi ngày (giờ Việt Nam) — Task 5.
5. **Học viên offline lâu trên tàu**: giải phóng thiết bị không thu hồi máy còn trong hạn học offline (37 ngày) — Task 6.

---

### Task 1: Bảng job và claim outbox

**Files:** migration `…_jobs`, `prisma/schema.prisma`. Test: `tests/integration/schema-jobs.test.ts`.

**Interfaces:** `job_leases(job_name PK, token uuid, generation bigint ≥ 1, holder text, expires_at)`; `job_runs(id, job_name, started_at, finished_at, status CHECK IN ('running','success','failed','skipped','timeout'), error, stats jsonb, generation bigint NULL)`; `job_requests(id, job_name, requested_by FK admin_users, requested_at, picked_at NULL, run_id FK job_runs NULL)`; `outbox_events` thêm `claim_token uuid NULL`, `claimed_until timestamptz NULL`; hàm SQL `admin_expire_invites() returns int` SECURITY DEFINER (invited quá hạn → expired, hủy link chưa dùng). Quyền `me_app`: SELECT/INSERT/UPDATE trên ba bảng mới; EXECUTE hàm mới.
- [ ] Test thất bại: CHECK trạng thái; `generation` 0 → lỗi; `admin_expire_invites()` chuyển đúng người quá hạn, không đụng người còn hạn hay active; `me_app` UPDATE thẳng `admin_users` vẫn 42501. → cài đặt → PASS → commit `feat(jobs): job lease, runs, requests schema`.

### Task 2: Lease, fencing, chạy một job

**Files:** `src/modules/jobs/{lease,runner}.ts`. Test: `tests/integration/job-lease.test.ts`.

**Interfaces:** `acquireLease(job, holder): Promise<Lease | null>` với `Lease = { job; token; generation }`; `heartbeat(lease): Promise<boolean>`; `releaseLease(lease)`; `withFence<T>(lease, fn: (tx) => Promise<T>): Promise<T>` (ném `LeaseLostError`); `runJob(def: JobDef, holder): Promise<JobRunResult>` với `JobDef = { name; run(ctx: { lease; signal: AbortSignal }): Promise<Record<string, unknown>>; timeoutMs }` — ghi `job_runs`, heartbeat, abort khi mất lease hoặc quá `timeoutMs` (status `timeout`), lỗi → `failed` + outbox cảnh báo nhóm lỗi (dedup theo job + giờ).
- [ ] Test thất bại: hai `acquireLease` song song → một lease; lease hết hạn → người khác lấy được, generation tăng; `withFence` với lease cũ → `LeaseLostError`, không ghi gì; `runJob` khi đang bị giữ → `skipped`; job ném lỗi → `failed` + 1 outbox `job_failed` telegram; job chạy quá giờ → `timeout`. → cài đặt → PASS → commit `feat(jobs): leases with fencing and run journal`.

### Task 3: Gửi outbox

**Files:** `src/modules/outbox/{deliver,telegram,messages}.ts`, `src/lib/env.ts` (biến Telegram tùy chọn). Test: `tests/integration/outbox-deliver.test.ts`, `tests/unit/outbox-messages.test.ts`.

**Interfaces:** `claimBatch(limit = 20): Promise<Claimed[]>`; `deliverBatch(senders: { telegram: TelegramSender; email: OutboxEmailSender }): Promise<{ sent; retried; dead; skipped }>`; `interface TelegramSender { send(chat: 'business' | 'errors', text: string): Promise<void> }` (thật: `fetch https://api.telegram.org/bot<token>/sendMessage`, timeout 10 s; chưa cấu hình → `NotConfiguredError`); `interface OutboxEmailSender { send(toUserId, kind, payload): Promise<void> }` (tra email học viên theo `userId`, không có email → bỏ qua, ghi `sent` với stats `no_email`). `renderMessage(event): { chat; text } | { subject; body }` cho `order_paid`, `order_refunded`, `ledger_queued`, `ledger_mismatch`, `job_failed`, `daily_summary`.
- [ ] Test thất bại: lô gửi được → `sent`; sender ném → `pending`, `next_attempt_at` lùi theo giãn cách, `last_error`; lần thứ 8 lỗi → `dead` + 1 outbox `outbox_dead` gửi nhóm lỗi (không lặp vô hạn: tin cảnh báo của chính nhóm lỗi chết thì không sinh thêm); `sending` có `claimed_until` đã qua → được lấy lại; hai `deliverBatch` song song → mỗi tin gửi đúng một lần; ghi `sent` với claim_token cũ → 0 dòng; Telegram chưa cấu hình → giữ `pending` `not_configured`, không tăng tới `dead`; tin nhắn không chứa nội dung chuyển khoản đầy đủ. → commit `feat(outbox): claimed delivery with retries`.

### Task 4: Job thường kỳ (hết hạn đơn, dọn phiên, lời mời, outbox)

**Files:** `src/modules/jobs/definitions.ts`. Test: `tests/integration/jobs-basic.test.ts`.

**Interfaces:** `JOBS: JobDef[]` gồm `me.orders.expire` (mỗi phút, gọi `expireOrders`), `me.outbox.deliver` (mỗi 10 giây), `me.sessions.cleanup` (mỗi giờ, `cleanupSessionArtifacts`), `me.admin.invites.expire` (mỗi giờ, `admin_expire_invites()` trong `withFence`); `schedule(def): { everyMs } | { dailyAt: 'HH:MM' }`; `isDue(def, lastRunAt, now): boolean` (giờ Việt Nam).
- [ ] Test thất bại: `isDue` cho mỗi phút / mỗi giờ / hằng ngày 21:00 giờ VN (20:59 VN chưa, 21:00 VN có, đã chạy 21:00 hôm nay thì 23:00 không); `runJob(me.orders.expire)` đặt đơn quá hạn `expired`; `me.admin.invites.expire` dùng fencing. → commit `feat(jobs): core scheduled jobs`.

### Task 5: Tổng kết 21:00

**Files:** `src/modules/jobs/daily-summary.ts`. Test: `tests/integration/daily-summary.test.ts`.

**Interfaces:** `dailySummary(now): Promise<{ day: string; paidOrders; revenueVnd; refunds; queueOpen; outboxDead }>` (ngày theo giờ VN); job `me.summary.daily` (21:00 VN) enqueue `daily_summary` telegram với `dedup_key = daily_summary:<YYYY-MM-DD>`.
- [ ] Test thất bại: số liệu đúng cho ngày VN (đơn paid lúc 23:30 VN hôm trước không tính); chạy hai lần cùng ngày → một outbox; worker lên lúc 21:05 → vẫn gửi (isDue). → commit `feat(jobs): daily telegram summary`.

### Task 6: Giải phóng thiết bị quá hạn

**Files:** `src/modules/jobs/devices-release.ts`. Test: `tests/integration/devices-release.test.ts`.

**Interfaces:** job `me.devices.release` (03:30 VN): thu hồi thiết bị có `last_seen_at` (hoặc `registered_at` khi chưa từng dùng) cũ hơn 37 ngày (= giấy phép 30 + ân hạn 7, đề xuất G9/G10) và mọi phiên của nó, trong `withFence`.
- [ ] Test thất bại: máy 36 ngày không đụng; 37 ngày + 1 giây → thu hồi, phiên null; máy đã thu hồi không ghi lại. → commit `feat(jobs): release devices past the offline window`.

### Task 7: Đối soát SePay (adapter, chờ G4)

**Files:** migration `…_reconciliation` (`reconciliation_cursors`), `src/modules/ledger/reconcile.ts`. Test: `tests/integration/reconcile.test.ts`.

**Interfaces:** `interface SepayApi { listTransactions(input: { from: Date; cursor?: string }): Promise<{ items: unknown[]; nextCursor?: string }> }` (thật: chưa có — `SEPAY_API_TOKEN` thiếu thì job ghi `skipped` với lý do `not_configured`); `reconcile(api, lease): Promise<{ pages; ingested; outcomes }>` — đọc từ `last_complete_bank_time − 2 giờ`, gọi `ingest()` nguồn `sepay_api`, chỉ cập nhật con trỏ (trong `withFence`) sau khi hết trang; job `me.sepay.reconcile` mỗi giờ.
- [ ] Test thất bại (API giả): hai trang → mọi giao dịch được ingest, con trỏ cập nhật; lỗi ở trang 2 → con trỏ không đổi, lần sau đọc lại không tạo trùng; giao dịch webhook bỏ sót được xác nhận qua đối soát. → commit `feat(ledger): sepay reconciliation behind an api adapter`.

### Task 8: Worker, trang quản trị job

**Files:** `src/worker/worker.ts`, `src/worker/alias-loader.mjs`, `package.json` (`"worker": "node --experimental-transform-types --import ./src/worker/alias-loader.mjs src/worker/worker.ts"`), routes `src/app/api/quan-tri/jobs/route.ts` (GET runs + lease, POST run-now). Test: `tests/integration/jobs-admin.test.ts`.

**Interfaces:** worker: mỗi 5 giây đọc `job_requests` chưa nhận + job đến hạn → `runJob`; SIGTERM → ngừng nhận job mới, chờ job đang chạy (tối đa 25 giây), nhả lease. `requestRun(ctx, job)` (`jobs.run`, audit `job_run_request`).
- [ ] Test thất bại: owner yêu cầu chạy → dòng `job_requests` + audit; support → 403 + audit denied; job lạ → 400; GET trả lần chạy gần nhất mỗi job. Chạy thử `pnpm worker` trên DB dev 20 giây: có `job_runs` success cho `me.orders.expire` và `me.outbox.deliver`, SIGTERM thoát sạch. → commit `feat(worker): scheduler process and admin job controls`.

### Task 9: Kiểm tra toàn bộ, tài liệu

- [ ] `pnpm test`, `lint`, `typecheck`, `build` xanh; `/codex-impl-review` tới APPROVE; cập nhật `CLAUDE.md` (lệnh `pnpm worker`, biến Telegram/SePay API), handoff, `PROGRESS.md`. Commit `docs: record p4 status`.

---

## Không nằm trong P4

Sao lưu và kiểm tra sao lưu (P5, G8); xóa dữ liệu quá hạn lưu/ghi âm (G12a, chưa có dữ liệu); dọn tệp media không còn tham chiếu (cần lịch sao lưu P5); email thật (G7); API SePay thật (G4).
