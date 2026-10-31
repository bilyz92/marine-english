# P5a — Đóng gói, sao lưu, giám sát, runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toàn bộ hệ thống chạy được bằng một lệnh Docker Compose trên một máy (Caddy, app, worker, Postgres), có sao lưu mã hóa, đã thử khôi phục thật trên máy này, có job giám sát và runbook. **Không triển khai thật:** chưa có VPS (G8), không push, không deploy.

**Architecture:** Một Dockerfile nhiều target (`app` = Next.js standalone; `worker` = mã TypeScript + `pg_dump`, `gpg`, `rclone`, `prisma`). Sao lưu là một job của worker dưới lease, gọi công cụ hệ thống qua một module duy nhất; media được chép vào kho theo mã băm (mỗi tệp mã hóa riêng, chỉ thêm tệp mới), mỗi bản DB ghi rõ cần những tệp nào. Giám sát là job đọc DB + ổ đĩa rồi xếp cảnh báo vào outbox. Nghiệm thu bằng chạy thật trên máy này, không chỉ unit test.

**Tech Stack:** như P1–P4; Caddy 2, PostgreSQL 16, GnuPG (mã hóa đối xứng AES256), rclone (đẩy ra ngoài, tùy chọn).

**Spec:** `docs/technical-design-draft-2026-10-30.md` §1; `docs/design-gates-2026-10-30.md` §8. Cổng: G8 (nhà cung cấp VPS, nơi lưu ngoài máy, người nhận cảnh báo, RPO/RTO).

## Global Constraints

- Không push, không deploy, không tạo tài nguyên ngoài máy này. Không tạo tệp chứa bí mật thật; mẫu cấu hình dùng giá trị rỗng.
- Bí mật chỉ đi qua biến môi trường hoặc tệp quyền 600; không in ra log, không nằm trong image hay tham số dòng lệnh (kể cả build arg ngoài `NEXT_PUBLIC_*`).
- Postgres không mở cổng ra ngoài máy chủ; chỉ Caddy mở 80/443. `/dev/*` không phục vụ ở production. Caddy không gắn volume media: mọi tệp đi qua app, tệp trả phí chỉ qua API có kiểm quyền.
- Hai vai trò hiện có giữ nguyên (`me_migrator` chỉ dùng khi migrate, `me_app` không DDL). Thêm `me_backup` chỉ đọc (`pg_read_all_data`) để worker không cần URL migrator.
- Ngân sách kết nối: `max_connections` 50; pool app 10, worker 7 (biến `DB_POOL_MAX`).
- Giờ hệ thống UTC; lịch ghi rõ giờ Việt Nam. Sao lưu 02:30 VN, giám sát mỗi 5 phút.
- Đề xuất G8, chưa chốt: RPO 24 giờ, RTO 1 ngày, giữ bản sao lưu 30 ngày. Thử khôi phục trên máy này **không đóng** G8: phải làm lại trên máy khác trước ra mắt.
- Migration từ nay phải tương thích ngược một phiên bản (thêm trước, xóa sau): điều kiện để quay lại bản trước.

## Review Focus

1. **Sao lưu chạy "xanh" nhưng khôi phục không được** (dump hỏng, sai khóa, thiếu tệp media, thiếu quyền đọc một bảng): chỉ tin khi đã khôi phục thật — Task 2, 3.
2. **Sao lưu chỉ nằm trên chính VPS** vì chưa cấu hình nơi lưu ngoài: phải có cảnh báo rõ, không im lặng báo thành công — Task 2.
3. **Bản ứng viên hỏng lúc deploy**: phát hiện trước khi thay bản đang chạy; migration chạy trước; quay lại được — Task 5.
4. **IP thật sau Caddy**: giới hạn tần suất OTP theo IP không được đọc nhầm giá trị người dùng tự gửi — Task 1.
5. **Worker chết nên giám sát cũng chết theo**: phải có tín hiệu quan sát được từ ngoài worker — Task 4.

---

### Task 1: Image và Compose chạy được từ volume trắng

**Files:** `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/postgres-init.sh`, `deploy/prod.env.example`, `docker/postgres-init.sql` (thêm `me_backup` cho dev/test), `next.config.ts` (`output: "standalone"`), `src/lib/db.ts` (`DB_POOL_MAX`), `src/lib/env.ts`, `tests/helpers/pg.ts`. Test: `tests/integration/prod-guards.test.ts`, `tests/integration/db-privileges.test.ts`.

**Interfaces:** target `app` (`node server.js`, cổng 3000, `GET /api/health`), target `worker` (lệnh `worker`, cũng chạy được `prisma migrate deploy`); cả hai chạy `prisma generate` lúc build vì `src/generated` không nằm trong git; build arg `NEXT_PUBLIC_LICENSE_PUBLIC_KEYS`. Dịch vụ: `postgres` (`postgres:16`, healthcheck `pg_isready`), `migrate` (một lần, target `worker`, chạy bằng `me_migrator`), `app` và `worker` (`depends_on: migrate: service_completed_successfully`), `caddy`. Mọi dịch vụ có healthcheck, `restart: unless-stopped` (trừ `migrate`), giới hạn CPU/RAM mẫu, giới hạn log (`max-size`, `max-file`); `worker` có `stop_grace_period: 60s`. Caddy: `APP_DOMAIN`, `header_up X-Forwarded-For {remote_host}` (ghi đè giá trị người dùng gửi), giới hạn thân yêu cầu, header bảo mật. `deploy/postgres-init.sh` chỉ tạo `me_migrator`, `me_app`, `me_backup` từ mật khẩu trong biến môi trường (không có mật khẩu dev cố định); `me_other` chỉ có ở dev/test. Lưu ý: `restart` chỉ khởi động lại khi tiến trình thoát, trạng thái `unhealthy` không làm Docker khởi động lại; healthcheck dùng để quan sát và để `depends_on` chờ.

- [ ] Test thất bại: `/dev/thu` ở production → 404; `me_backup` đọc được mọi bảng (kể cả bảng tạo sau này), không INSERT/UPDATE/DELETE, không DDL.
- [ ] Cài đặt. Chạy thật trên volume trắng với `APP_DOMAIN=localhost` và cổng phụ: một lệnh `docker compose -f docker-compose.prod.yml up -d --build` → mọi dịch vụ `healthy`, `migrate` thoát 0, `curl -k https://localhost:<cổng>/api/health` trả 200, worker ghi `job_runs`, Postgres không có cổng ngoài. Gửi OTP qua Caddy với `X-Forwarded-For: 1.2.3.4` giả → `otp_send_log` ghi IP thật của kết nối, không phải 1.2.3.4. Qua Caddy: tệp công khai tải được, tệp trả phí không đăng nhập → 401, không có đường dẫn nào tới thư mục `protected/`.
- [ ] Commit `feat(deploy): production images and compose stack`.

### Task 2: Sao lưu

**Files:** `src/modules/ops/backup.ts`, `src/modules/ops/run-tool.ts`, `src/modules/jobs/runner.ts`, `src/modules/jobs/definitions.ts`, `src/worker/worker.ts`, `src/lib/env.ts`. Test: `tests/integration/backup.test.ts` (công cụ giả qua `RunTool`), `tests/integration/job-lease.test.ts`, `tests/unit/run-tool.test.ts`, `tests/unit/backup-retention.test.ts`.

**Interfaces:** `type Step = { cmd: string; args: string[]; env?: Record<string, string> }`; `type RunTool = (steps: Step[], opts: { stdinFile?: string; stdoutFile?: string; signal: AbortSignal }) => Promise<void>`: nối các bước bằng pipe trực tiếp, một bước thoát khác 0 là cả lệnh lỗi. Tiến trình con chạy trong nhóm riêng; hủy → SIGTERM cả nhóm, sau 10 giây SIGKILL, rồi chờ thoát hẳn. `backup({ run, now, signal, lease }): Promise<BackupStats>`.

**Runner chờ job dọn xong:** khi quá giờ hoặc worker tắt, `runJob` hủy job rồi **chờ job kết thúc tối đa 30 giây** (`cleanupMs`), vẫn gia hạn lease trong lúc chờ, sau đó mới ghi kết quả và nhả lease. Mất lease thì không nhả được nên vẫn chỉ chờ tới hạn đó; an toàn dựa vào thư mục tạm riêng và fence trước khi công bố. Worker: chờ job 25 giây rồi hủy, chờ thêm tối đa 30 giây, tổng 55 giây, dưới `stop_grace_period` 60 giây.

**Không có dump chưa mã hóa trên đĩa:** `pg_dump` nối thẳng vào `gpg`, không qua tệp tạm; khôi phục cũng nối `gpg` vào `pg_restore`.

Bố cục `BACKUP_DIR`: `db/<YYYY-MM-DD-HHmm>/{db.dump.gpg, manifest.json}` và `media-store/<sha256>.<kid>.gpg`. Thứ tự: (1) mở transaction `REPEATABLE READ` bằng `BACKUP_DATABASE_URL`, `pg_export_snapshot()`, đọc số dòng `orders`, `bank_transactions`, `enrollments`, phiên bản migration mới nhất và danh sách `media_assets` trong snapshot đó, `pg_dump -Fc --snapshot` trên chính snapshot đó; (2) chép media sau DB (tệp chỉ thêm, nên mọi tệp DB trỏ tới đều đã có): tệp nào chưa có bản mã hóa bằng **khóa hiện tại** trong kho thì mã hóa vào kho, kiểm sha256 trước khi mã hóa; thiếu tệp → job failed; (3) `manifest.json` gồm `kid`, kích thước và sha256 của dump đã mã hóa, số dòng, danh sách media (`sha256`, `kid`, `visibility`, `storage_key`, đủ để dựng lại đúng thư mục `MEDIA_ROOT`). Làm trong thư mục tạm riêng từng lần chạy; trước khi đổi tên sang tên chính thức và trước khi dọn bản cũ phải qua `withFence`; lần chạy mất lease dọn thư mục tạm của mình.

Khóa: `BACKUP_KEYS_DIR/<kid>` (tệp passphrase, quyền 600), `BACKUP_KEY_ID` là khóa hiện tại. Sau khi đổi khóa, bản sao lưu mới mã hóa lại dần media sang khóa mới; manifest cũ vẫn trỏ bản cũ tới khi hết 30 ngày, lúc đó bản cũ bị dọn và khóa cũ mới được bỏ. Thiếu khóa của một bản đang giữ → cảnh báo.

Giữ: bản DB 30 ngày, không bao giờ xóa bản mới nhất; tệp trong kho media chỉ xóa khi không manifest nào còn giữ trỏ tới.

Đẩy ra ngoài (`BACKUP_RCLONE_REMOTE`, tùy chọn): tệp media mới trước, rồi `db/<tên>/`, `rclone check`, cuối cùng ghi tệp `COMPLETE` (sha256 của manifest); bản không có `COMPLETE` không được dùng để khôi phục và được dọn ở lần sau; dọn bản cũ trên remote theo cùng quy tắc.

Job `me.backup.daily` (02:30 VN, timeout 2 giờ). Thiếu cấu hình ở production → `skippedReason: not_configured` **kèm cảnh báo** mỗi ngày. Có sao lưu nhưng chưa có remote → thành công, `offsite: false`, cảnh báo nhóm lỗi mỗi ngày.

- [ ] Test thất bại: lần chạy thành công tạo đủ tệp và manifest; lần sau không mã hóa lại tệp media đã có; công cụ lỗi giữa chừng → failed, không có bản chính thức, thư mục tạm được dọn; mất lease trước khi công bố → không có bản chính thức, không dọn gì; hai lần chạy dùng thư mục tạm khác nhau; passphrase không xuất hiện trong args hay lỗi; không có remote → `offsite: false` + một cảnh báo mỗi ngày; giữ 30 ngày, không xóa bản mới nhất, media còn được manifest trỏ tới không bị xóa; rclone lỗi → failed và không ghi `COMPLETE`; đổi khóa → manifest mới chỉ trỏ tệp `kid` mới, manifest cũ giữ nguyên, hết 30 ngày thì tệp `kid` cũ bị dọn; bước đầu của pipe lỗi → failed; hủy `RunTool` thật với tiến trình con bỏ qua SIGTERM → bị SIGKILL và đã thoát khi hàm trả về; job dọn chậm → lease chưa nhả cho tới khi dọn xong, quá 30 giây thì vẫn kết thúc; kill đột ngột giữa chừng → không có tệp dump chưa mã hóa nào trên đĩa. → cài đặt → commit `feat(ops): encrypted daily backup job`.

### Task 3: Khôi phục thật và thử khôi phục

**Files:** `deploy/restore-lib.sh`, `deploy/restore.sh`, `deploy/restore-drill.sh`.

**Interfaces:** `restore-lib.sh` là phần lõi dùng chung: giải mã theo `kid` trong manifest, `gpg` nối vào `pg_restore --exit-on-error` (không dùng `--no-owner`: các hàm SECURITY DEFINER phải giữ đúng chủ), dựng lại `MEDIA_ROOT` theo `visibility` và `storage_key` kèm kiểm sha256 từng tệp. `restore.sh <bản sao lưu> <thư mục khóa>`: khôi phục thật lên DB trống và volume media trống; DB không trống hoặc media không trống → từ chối. Bản lấy từ remote phải có `COMPLETE` khớp sha256 của manifest.

`restore-drill.sh <bản sao lưu> <thư mục khóa>`: gọi cùng phần lõi trên Postgres tạm `postgres:16` (cùng phiên bản với production), chỉ nghe loopback ở cổng ngẫu nhiên, tạo các vai trò, so số dòng và phiên bản migration với manifest, kiểm mọi `media_assets` có tệp tương ứng, chạy được một truy vấn đọc khóa học và đơn bằng vai trò `me_app`, `trap` dọn sạch khi thoát hoặc bị ngắt. Lỗi bất kỳ → mã thoát khác 0.

- [ ] Chạy thật trên stack Task 1: tạo dữ liệu có media (công khai và trả phí), chạy sao lưu, drill → so khớp; đổi khóa, sao lưu lần nữa, drill cả hai bản → đều qua; rclone với remote thư mục cục bộ, tải về rồi drill → qua; làm hỏng một tệp → thoát khác 0; sai khóa → thoát khác 0. `restore.sh` lên một stack trắng thứ hai → app đọc được khóa học, tệp công khai tải được, tệp trả phí vẫn cần quyền; chạy lại trên DB đã có dữ liệu → từ chối.
- [ ] Commit `feat(ops): restore script and restore drill`.

### Task 4: Giám sát

**Files:** `src/modules/ops/watch.ts`, `src/app/api/health/worker/route.ts`, `src/worker/worker.ts`, `src/worker/watchdog.ts`, `src/modules/jobs/runner.ts`, `src/modules/jobs/definitions.ts`, `src/modules/outbox/messages.ts`. Test: `tests/integration/ops-watch.test.ts`, `tests/unit/watchdog.test.ts`.

**Interfaces:** `watch(now): Promise<Alert[]>`; job `me.ops.watch` (mỗi 5 phút) xếp cảnh báo kind `ops_alert` (`dedup_key` theo loại + giờ, riêng sao lưu theo ngày): ổ đĩa ≥ 70% / ≥ 85% (`fs.statfs`), app không trả lời `APP_HEALTH_URL`, sao lưu thành công gần nhất quá 26 giờ (đã có lần chạy mà chưa thành công lần nào thì tính từ lần chạy đầu tiên), job lặp không hoàn thành trong 3 chu kỳ, job hằng ngày đã chạy trước đây mà lỡ lịch quá 1 giờ, outbox `pending` quá hạn 30 phút (trừ `not_configured`) hoặc có `dead` mới, chứng chỉ của `APP_ORIGIN` còn dưới 14 ngày (chỉ khi https). “Hoàn thành” = `success` hoặc `skippedReason` (chưa cấu hình không phải lỗi, sao lưu có cảnh báo riêng). Job chưa từng chạy không tính lỡ lịch: job lặp chạy ngay ở lượt đầu, job hằng ngày chạy ngay sau giờ hẹn, nên chưa có dòng nào nghĩa là chưa tới hạn; worker chết đã có tín hiệu riêng dưới đây.

**Worker chết hoặc treo:** cảnh báo do chính worker gửi nên cần ba lớp tách bạch. (a) Tiến trình thoát: `restart` của Docker khởi động lại. (b) Treo mà event loop còn chạy: `watchdog.ts`: lượt `tick` không xong trong 5 phút → ghi log rồi `process.exit(1)` để Docker khởi động lại. (c) Treo hẳn hoặc bị dừng: `GET /api/health/worker` trả 503 khi không có `job_runs` nào của `me.outbox.deliver` trong 2 phút; dịch vụ theo dõi bên ngoài gọi `/api/health` và `/api/health/worker` rồi báo người trực: chọn ở G8, ghi vào danh sách trước ra mắt. Healthcheck Compose đọc tệp heartbeat chỉ để hiện `unhealthy`, không tự sửa gì.

**Kênh cảnh báo chưa cấu hình:** mọi cảnh báo đi qua Telegram, thiếu token thì tin nằm chờ. Ở production `/api/health/worker` trả 503 kèm lý do `alerts_not_configured` khi thiếu `TELEGRAM_BOT_TOKEN` hoặc `TELEGRAM_ERROR_CHAT_ID`, để việc thiếu kênh không bị im lặng.

**Dòng `running` bỏ dở:** `job_runs.status='running'` mà lease đã hết hạn hoặc khác `generation` → `failed`, lỗi `abandoned`, chỉ khi vẫn `running`. Runner ghi kết thúc cũng chỉ khi dòng còn `running`, nên bên nào ghi trước thì giữ kết quả đó.

- [ ] Test thất bại: mỗi điều kiện sinh đúng một cảnh báo trong một giờ; không có điều kiện → không cảnh báo; job `skipped` chưa cấu hình không bị báo; `abandoned` không đụng dòng đang giữ lease; runner kết thúc sau khi bị đánh `abandoned` không ghi đè, và ngược lại; `/api/health/worker` 200/503 đúng, gồm trường hợp thiếu kênh cảnh báo ở production; sao lưu thất bại mọi lần, chưa từng thành công → vẫn báo; watchdog: lượt tick treo quá 5 phút → báo cần thoát, lượt chạy bình thường → không.
- [ ] Cài đặt. Chạy thật trên stack Task 1: `docker stop` worker → `/api/health/worker` 503 trong 2 phút, chạy lại → 200. Giết tiến trình trong container (`kill -9`) → Docker tự khởi động lại và `job_runs` có dòng mới.
- [ ] Commit `feat(ops): monitoring job and worker liveness`.

### Task 5: Deploy, quay lại, runbook

**Files:** `deploy/deploy.sh`, `docs/runbook.md`, `CLAUDE.md`, `docs/session-handoff.md`, roadmap.

**Interfaces:** `deploy.sh <tag>`: build image có tag → `prisma migrate deploy` bằng `me_migrator` (migration tương thích ngược nên bản đang chạy vẫn chạy được) → chạy thử container ứng viên trên mạng nội bộ, gọi `/api/health`; hỏng thì **dừng, bản đang chạy không bị đụng** → thay `app` (một VPS nên có khoảng gián đoạn ngắn, đo và ghi vào runbook) → `docker compose stop -t 60 worker` → chạy `worker` mới. `IMAGE_TAG` cho phép quay lại tag cũ, không đảo migration; quay lại không chạy `migrate` của tag cũ trừ khi bước chạy thật dưới đây cho thấy Prisma chấp nhận DB có migration mới hơn. Không viết CI (chưa có remote; G8).

Runbook tiếng Việt, viết cho người vận hành trên bờ: cài máy mới từ đầu, mỗi cảnh báo một mục ngắn (nghĩa là gì, làm gì), sao lưu và khôi phục, đổi khóa (cả khóa sao lưu), quay lại bản trước, quy tắc migration thêm trước xóa sau, ai làm khi chủ dự án ở biển.

**Thử khôi phục mỗi quý trên máy khác** (DG §8), ghi trong runbook: người vận hành trên bờ làm, chủ dự án biết kết quả. Mỗi lần: lấy bản mới nhất từ nơi lưu ngoài, mở bản mã hóa của tệp env và khóa để chứng minh còn dùng được, chạy `restore-drill.sh` trên máy không phải VPS. Lưu ngày, tên bản sao lưu, thời gian khôi phục và kết quả vào một sổ trong runbook. Thất bại → coi như không có sao lưu: sửa ngay, không để sang quý sau.

**Khôi phục bí mật:** tệp env và thư mục khóa sao lưu không nằm trong bản sao lưu (nếu không sẽ vòng tròn). Runbook quy định: một bản mã hóa của hai thứ này do chủ dự án và người vận hành giữ ở nơi ngoài VPS, kiểm tra được mở khi thử khôi phục, cập nhật mỗi lần đổi khóa. Mất khóa ký giấy phép chỉ buộc học viên đồng bộ lại; mất khóa sao lưu là mất bản sao lưu: ghi rõ.

**Danh sách trước ra mắt (G8), ghi trong runbook:** cấu hình Telegram và gửi thử một cảnh báo tới nhóm lỗi, chọn VPS và kích thước giới hạn tài nguyên thật, nơi lưu ngoài, dịch vụ theo dõi bên ngoài, tường lửa 80/443 + SSH khóa, NTP, cập nhật bảo mật, cảnh báo RAM/CPU máy chủ, người nhận cảnh báo, thử khôi phục trên máy khác.

- [ ] Chạy thật trên một Compose project và volume **riêng, dùng xong xóa cả stack** (không sửa tay cột hay lịch sử migration của stack thường): ứng viên hỏng (lệnh khởi động sai) → script dừng, bản cũ vẫn trả 200. Deploy tag B có một migration thêm cột thử nghiệm (không commit) trong lúc gọi `/api/health` liên tục, đo gián đoạn; quay lại tag A trên schema mới → health xanh, kể cả ghi lại kết quả `prisma migrate deploy` của tag A trên DB mới hơn; xóa project thử cùng volume. Worker cũ thoát trong 60 giây.
- [ ] `pnpm test`, `lint`, `typecheck`, `build` xanh; `/codex-impl-review` tới APPROVE. Commit `docs: runbook and p5a status`.

---

## Không nằm trong P5a

Giao diện bán hàng (P5b). Thuê VPS, tên miền, CI, nơi lưu ngoài thật, dịch vụ theo dõi bên ngoài (G8). Khóa tệp `me_locks` trong thiết kế §1: bỏ, vì sao lưu đã có lease, thư mục tạm riêng từng lần và fence trước khi công bố; chưa có job dọn media. Cảnh báo “webhook lỗi chữ ký tăng bất thường”: làm khi có webhook thật (G4).
