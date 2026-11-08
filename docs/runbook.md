# Runbook vận hành Marine English

Viết cho người vận hành trên bờ. Chủ dự án thường ở trên tàu: việc gì cần quyết thì nhắn chủ, việc vận hành thường ngày làm theo tài liệu này.

Mọi lệnh chạy trong thư mục mã nguồn trên máy chủ. `ENV=deploy/prod.env` (quyền 600, không commit).

## 1. Hệ thống gồm gì

Một máy chủ, một tệp `docker-compose.prod.yml`:

| Dịch vụ | Việc | Ghi chú |
| --- | --- | --- |
| `caddy` | HTTPS, chuyển tiếp vào app | Chỉ dịch vụ này mở cổng 80/443 |
| `app` | Website, app học, API, trang quản trị | `/api/health` |
| `worker` | Gửi thông báo, job định kỳ, sao lưu, giám sát | Không mở cổng; `/api/health/worker` báo nó còn sống |
| `postgres` | Cơ sở dữ liệu | Không mở cổng ra ngoài |
| `migrate` | Chạy migration rồi thoát | Chạy trước app và worker |

Dữ liệu nằm ở các volume `pgdata`, `media`, `backups`, `caddy_data`. Khóa sao lưu nằm ở `BACKUP_KEYS_HOST_DIR` trên máy chủ (không trong volume).

## 1A. Máy đang chạy: 103.180.134.101 (conghung.ce-tanker.vn), từ 02/11/2026

- Tên miền (đổi 08/11/2026): **https://conghung.ce-tanker.vn** là tên chính (`APP_ORIGIN`); `ce-tanker.vn` và `www.ce-tanker.vn` chuyển hẳn (301) về tên chính;
  `marine-english.heytek.vn` đã bỏ, nginx đóng kết nối (444) để không rơi vào trang khác của máy. Một chứng chỉ chung `ce-tanker.vn` cho 3 tên, gia hạn qua
  webroot `/var/www/certbot`. Đổi tên miền lần sau: sửa `APP_ORIGIN` trong `prod.env`, cấu hình nginx, `up -d app worker`, rồi đăng ký lại webhook Telegram (lệnh `setWebhook` ở mục 8).
  Học viên đã cài app từ tên cũ phải cài lại từ tên mới (dữ liệu học offline nằm theo tên miền).

- Máy dùng chung với heytek và crmgo; hai dự án này **đang tạm tắt** theo yêu cầu của chủ dự án để đủ RAM (1,8 GB). Lệnh bật lại: `~/DU-AN-DA-TAT.md` trên máy.
- nginx của máy giữ cổng 80/443 và chuyển tiếp vào app ở `127.0.0.1:3100` (`/etc/nginx/sites-available/marine-english`, mẫu ở `deploy/nginx-marine-english.conf`);
  chứng chỉ Let's Encrypt do certbot cấp và tự gia hạn. Không chạy Caddy: luôn kèm `deploy/compose.nginx.yml` (cũng chứa giới hạn RAM cho máy này).
- Thư mục `~/marine-english`: chỉ có các tệp compose, `deploy/` và `deploy/prod.env` (quyền 600, khóa sinh riêng cho máy này). Không có mã nguồn:
  image build ở máy phát triển rồi chuyển lên.
- Cập nhật bản mới. Máy phát triển **không** giữ `prod.env` hay khóa bí mật: build chỉ cần khóa công khai của giấy phép học offline,
  lấy từ máy chủ (giá trị này công khai).

      set -euo pipefail
      TAG=$(git rev-parse --short HEAD)
      PUB=$(ssh ubuntu@103.180.134.101 "grep ^NEXT_PUBLIC_LICENSE_PUBLIC_KEYS= ~/marine-english/deploy/prod.env | cut -d= -f2-")
      # Thiếu khóa công khai thì app không tin giấy phép học offline nào: dừng, không build.
      test -n "$PUB" || { echo "Không lấy được khóa công khai"; exit 1; }
      docker buildx build --load --target app    --build-arg NEXT_PUBLIC_LICENSE_PUBLIC_KEYS="$PUB" -t marine-english-app:$TAG .
      docker buildx build --load --target worker --build-arg NEXT_PUBLIC_LICENSE_PUBLIC_KEYS="$PUB" -t marine-english-worker:$TAG .
      docker save marine-english-app:$TAG marine-english-worker:$TAG | gzip -1 | ssh ubuntu@103.180.134.101 'gunzip | docker load'
      scp docker-compose.prod.yml ubuntu@103.180.134.101:marine-english/ && scp deploy/*.yml deploy/*.sh deploy/*.mjs ubuntu@103.180.134.101:marine-english/deploy/
      ssh ubuntu@103.180.134.101 'cd ~/marine-english && ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml deploy/deploy.sh deploy/prod.env '$TAG' --skip-build'

  Đổi khóa ký giấy phép (`LICENSE_SIGNING_KEYS` trên máy chủ) thì phải build lại với khóa công khai mới.
- Sao lưu: khóa `b2026a` ở `~/marine-english-backup-keys/` (quyền 600, uid 1000). Bản đầu 02/11/2026, thử khôi phục trên máy phát triển: đạt.
  **Chưa có nơi lưu ngoài** (`BACKUP_RCLONE_REMOTE` trống): bản sao lưu đang nằm cùng ổ đĩa với dữ liệu.
- Đăng nhập `/admin` khi chưa có email (G7): trên máy chủ chạy `cd ~/marine-english && ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml deploy/cli.sh deploy/prod.env admin:login-link <email>`.
  Lệnh in link đăng nhập 15 phút, dùng một lần; chỉ người vào được máy chủ dùng được; mỗi lần in đều ghi nhật ký `cli_login_link`.
  Tài khoản chủ đầu tiên: `ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml deploy/cli.sh deploy/prod.env admin:bootstrap <email>`.
- Chưa có: nhà cung cấp email (G7) và mã Google; khóa học còn nháp; chưa có thông tin thanh toán (G4); chưa có nơi lưu ngoài cho sao lưu; chưa có Telegram.

## 2. Cài máy mới từ đầu

1. Cài Docker và Docker Compose. Bật NTP. Tường lửa chỉ mở 80, 443 và SSH (đăng nhập bằng khóa, tắt mật khẩu).
2. Lấy mã nguồn, chép `deploy/prod.env.example` thành `deploy/prod.env`, `chmod 600`, điền mọi mục. Khóa 32 byte: `openssl rand -base64 32`. **Mật khẩu DB dùng `openssl rand -hex 24`** (ký tự `/ + @` của base64 làm hỏng địa chỉ kết nối). `NEXT_PUBLIC_LICENSE_PUBLIC_KEYS`: chạy `pnpm cli license:public-keys` trên máy có mã nguồn với `LICENSE_SIGNING_KEYS` đã điền.
3. Khóa sao lưu: tạo thư mục `BACKUP_KEYS_HOST_DIR`, mỗi khóa một tệp tên là mã khóa (ví dụ `b2026a`), nội dung `openssl rand -base64 48`, `chown 1000:1000`, `chmod 600`. Đặt `BACKUP_KEY_ID` là mã đó. **Không bao giờ dùng lại một mã khóa cho nội dung khóa khác**: tệp đã mã hóa bằng mã cũ sẽ bị dùng lại và không mở được. Làm ngay bản lưu khóa ngoài máy (mục 6).
4. `docker compose -f docker-compose.prod.yml --env-file $ENV up -d --build`. Đợi mọi dịch vụ `healthy`: `docker compose ... ps`.
5. Tạo tài khoản chủ (mật khẩu đọc từ tệp env, không gõ ra dòng lệnh):
   ```
   set -a; . deploy/prod.env; set +a
   export MIGRATOR_DATABASE_URL="postgresql://me_migrator:${ME_MIGRATOR_PASSWORD}@postgres:5432/${ME_DB_NAME}"
   docker compose -f docker-compose.prod.yml --env-file deploy/prod.env run --rm -e MIGRATOR_DATABASE_URL worker node src/worker/cli.ts admin:bootstrap <email chủ>
   ```
6. Kiểm: `https://<tên miền>/api/health` trả `{"ok":true}`, `/api/health/worker` trả `{"ok":true}` (nếu trả `alerts_not_configured` là chưa điền Telegram).

## 3. Deploy và quay lại bản trước

```
deploy/deploy.sh $ENV <tag mới>
```

Script build, chạy migration, chạy thử app mới trong mạng nội bộ; app mới không khỏe thì **dừng, bản đang chạy giữ nguyên**. Khỏe thì thay app (trang gián đoạn khoảng 4–5 giây, đo ngày 31/10/2026 trên máy thử), rồi dừng worker cũ (tối đa 60 giây để làm xong việc dở) và chạy worker mới.

Script ghi tag đang chạy vào `IMAGE_TAG` của tệp env. **Giữ image của ít nhất 3 tag gần nhất**; khi dọn đĩa không dùng `docker image prune -a` hay `docker system prune -a`. Thiếu image của tag cũ thì script từ chối quay lại.

Quay lại bản trước (không đảo migration):

```
deploy/deploy.sh $ENV <tag cũ> --skip-build --skip-migrate
```

Đã thử 31/10/2026: bản cũ chạy được trên DB đã có migration mới hơn; chạy `migrate` của bản cũ trên DB mới hơn chỉ báo “No pending migrations” và không làm gì.

**Quy tắc migration (để quay lại được):** mỗi bản phải chạy được với DB của bản kế tiếp. Thêm trước, xóa sau: thêm cột hay bảng ở bản N, bản N+1 mới bỏ dùng cái cũ, bản N+2 mới xóa. Không đổi tên cột trong một bước.

## 4. Sao lưu

Job `me.backup.daily` chạy 02:30 giờ Việt Nam: bản dump DB (nối thẳng `pg_dump` vào `gpg`, không có bản chưa mã hóa trên đĩa), media mã hóa từng tệp vào kho theo mã băm, `manifest.json` ghi đủ để dựng lại. Giữ 30 ngày, không bao giờ xóa bản mới nhất. Có `BACKUP_RCLONE_REMOTE` thì đẩy ra ngoài, kiểm, rồi mới ghi `COMPLETE`; bản ở ngoài không có `COMPLETE` là chưa xong, không dùng.

Chạy ngay: trang quản trị → Job → `me.backup.daily` → Chạy ngay.

Nơi lưu ngoài chỉ dọn bản quá 30 ngày theo ngày của chính nó, không sao y máy chủ: máy chủ mất dữ liệu sao lưu không kéo theo bản ở ngoài. Kho media ở ngoài chỉ thêm, không tự dọn.

## 5. Khôi phục

**Thử khôi phục** (không đụng hệ thống đang chạy, chạy trên máy bất kỳ có Docker và image worker):

```
deploy/restore-drill.sh <volume hoặc thư mục sao lưu> <thư mục khóa> [tên bản] [--require-complete]
```

Kết thúc bằng `KHÔI PHỤC ĐẠT` và mã thoát 0. Bản lấy từ nơi lưu ngoài thì thêm `--require-complete`. Mỗi bản có `manifest.mac` ký bằng khóa sao lưu: manifest bị sửa (kể cả ở nơi lưu ngoài) hoặc sai khóa thì khôi phục từ chối trước khi chạy gì.

**Khôi phục thật** khi mất máy chủ:

1. Dựng máy mới theo mục 2 bước 1–3, với tệp env và khóa lấy từ bản lưu ngoài máy (mục 6).
2. Tải bản sao lưu từ nơi lưu ngoài về một thư mục (giữ cấu trúc `db/` và `media-store/`).
3. `docker compose -f docker-compose.prod.yml --env-file $ENV up -d postgres` (chỉ Postgres; tạo vai trò và DB trống).
4. `deploy/restore.sh $ENV <thư mục sao lưu> <thư mục khóa> --require-complete`. Script tự build image worker từ mã nguồn, chọn bản mới nhất có `COMPLETE`, và từ chối nếu DB hoặc media đích không trống.
5. `docker compose ... up -d`. `migrate` sẽ báo không có gì để làm.
6. Kiểm như mục 2 bước 6, mở thử một khóa học và trang quản trị.

Mục tiêu đề xuất (chờ G8): mất tối đa 24 giờ dữ liệu, dựng lại trong 1 ngày.

### Thử khôi phục mỗi quý trên máy khác

Người vận hành trên bờ làm, báo kết quả cho chủ dự án.

1. Trên một máy **không phải** máy chủ, có Docker và mã nguồn: `docker build --target worker -t marine-english-worker:local .`; tải các bản từ nơi lưu ngoài về một thư mục (giữ `db/` và `media-store/`); chép khóa vào một thư mục, `chown 1000` các tệp khóa.
2. Mở bản lưu tệp env và khóa (mục 6) để chứng minh vẫn mở được.
3. `deploy/restore-drill.sh <thư mục tải về> <thư mục khóa> --require-complete`.
4. Ghi vào bảng dưới. Hỏng thì coi như **không có sao lưu**: sửa ngay, không để sang quý sau.

| Ngày | Người làm | Bản sao lưu | Thời gian khôi phục | Kết quả |
| --- | --- | --- | --- | --- |
| 31/10/2026 | (thử trên máy phát triển, chưa phải máy khác) | bản thử | dưới 1 phút | Đạt; chưa tính cho G8 |

## 6. Khóa và bí mật

Tệp `deploy/prod.env` và thư mục khóa sao lưu **không** nằm trong bản sao lưu (nếu có thì muốn mở bản sao lưu lại cần chính nó). Vì vậy:

- Giữ một bản mã hóa của hai thứ này ở ngoài máy chủ, do chủ dự án và người vận hành cùng giữ (ví dụ trình quản lý mật khẩu dùng chung). Cập nhật mỗi lần đổi khóa. Mỗi lần thử khôi phục phải mở được bản này.
- **Mất khóa sao lưu là mất mọi bản sao lưu dùng khóa đó.** Không có cách lấy lại.
- Mất khóa ký giấy phép học offline: tạo khóa mới, build lại app; học viên chỉ cần đồng bộ lại khi có mạng.

**Đổi khóa sao lưu:** tạo tệp khóa mới (mã mới), đổi `BACKUP_KEY_ID`, `deploy/deploy.sh $ENV <tag hiện tại> --skip-build --skip-migrate` để worker đọc cấu hình mới. Bản mới mã hóa lại dần media bằng khóa mới. **Giữ khóa cũ ít nhất 30 ngày** (tới khi bản cuối dùng nó hết hạn); job sao lưu báo nếu thiếu khóa của bản còn giữ. Cập nhật bản lưu ngoài máy.

**Đổi khóa phiên, pepper OTP, khóa ký giấy phép, bí mật SePay:** thêm khóa mới vào danh sách (khóa mới đứng trước), đổi mã khóa hiện tại, deploy; giữ khóa cũ tới khi hết hạn dùng rồi mới bỏ.

## 7. Cảnh báo (nhóm Telegram lỗi)

| Tin | Nghĩa là | Làm gì |
| --- | --- | --- |
| Ổ đĩa đã dùng 70% / 85% | Sắp đầy đĩa | Xem `docker system df`; xóa image cũ hơn 3 tag gần nhất (không dùng `prune -a`); `docker builder prune`; nâng gói đĩa nếu media lớn dần |
| Trang web không trả lời | App chết hoặc treo | `docker compose ... ps`, `logs app --tail 100`; `restart app`; vẫn hỏng thì quay lại bản trước |
| Chứng chỉ HTTPS còn N ngày | Caddy không gia hạn được | `logs caddy`; kiểm tên miền còn trỏ đúng máy chủ, cổng 80 mở |
| Quá 26 giờ không có bản sao lưu | Sao lưu hỏng hoặc không chạy | Trang quản trị → Job xem lỗi `me.backup.daily`; chạy ngay; kiểm khóa, chỗ trống đĩa, nơi lưu ngoài |
| Sao lưu chỉ nằm trên máy chủ | Chưa cấu hình nơi lưu ngoài | Cấu hình `BACKUP_RCLONE_REMOTE` (G8) |
| Có bản sao lưu với manifest hỏng, đã ngừng dọn | Một thư mục trong `db/` có `manifest.json` hỏng hoặc lệch tên | Xem thư mục đó; không mở được thì chuyển nó ra khỏi `db/` (đừng xóa vội). Việc dọn bản cũ chạy lại ở lần sao lưu sau |
| Sao lưu có trên máy chủ nhưng đẩy ra ngoài lỗi | Nơi lưu ngoài hoặc mạng lỗi | Kiểm cấu hình rclone, dung lượng nơi lưu ngoài; chạy ngay lại sao lưu khi đã sửa |
| Sao lưu không chạy: chưa cấu hình | Thiếu `BACKUP_*` | Điền theo mục 2 bước 3 |
| Thiếu tệp khóa sao lưu … | Một bản còn giữ dùng khóa đã bị xóa khỏi máy chủ | Chép lại tệp khóa từ bản lưu ngoài máy (mục 6); không có thì các bản đó không mở được |
| N thông báo chờ gửi quá 30 phút | Telegram hoặc email lỗi kéo dài | Kiểm token, mạng máy chủ; tin không mất, sẽ gửi khi hết lỗi |
| N thông báo đã ngừng thử gửi | Một thông báo lỗi 8 lần | Xem `last_error` trong bảng `outbox_events`; báo chủ nếu là thông báo cho học viên |
| Job … không hoàn thành trong 3 chu kỳ / lỡ lịch | Job lỗi liên tục hoặc worker treo | Trang quản trị → Job xem lỗi; `logs worker`; `restart worker` |
| Job … lỗi / quá giờ | Một lần chạy hỏng | Xem lỗi; thường tự hết ở lần sau; lặp lại thì báo chủ |

**Không nhận được tin nào cả** cũng là dấu hiệu: worker hoặc Telegram có thể đã chết. Dịch vụ theo dõi bên ngoài (G8) gọi `/api/health` và `/api/health/worker` để báo trong trường hợp này.

## 6A. Thêm và sửa nội dung khóa học (từ 02/11/2026)

- Chỉ chủ, đăng nhập trong 10 phút gần đây. `/admin/noi-dung`: chọn tệp `.zip` (gói học liệu như `docs/07_Oiler.zip`), `.json` (tệp `*_Learning_Data_*.json`) hoặc `.docx` (ngân hàng câu hỏi Word, chỉ có câu hỏi tiếng Anh) → **Xem trước** → **Nhập vào hệ thống**. Tối đa 16 MB, mỗi lúc một lần nhập.
- Khóa mới luôn ở dạng nháp. Khóa **đang bán** mà nội dung đổi thì trang bắt tích xác nhận; học viên thấy nội dung mới ở lần mở bài sau, tiến độ giữ nguyên.
- Sửa hoặc thêm bài: `/admin/khoa-hoc` → **Bài học** của khóa → **Sửa** / **Thêm bài**; **Tạo khóa mới** cho khóa trống. Mỗi lần lưu tạo phiên bản mới, không mất bản cũ; mọi lần nhập/sửa ghi nhật ký quản trị.
- Báo "Đang có thao tác nội dung khác" (409 busy) hoặc "vừa được sửa ở chỗ khác" (409 stale): đợi vài giây, tải lại trang rồi làm lại.
- nginx phải có khối `location = /api/quan-tri/content/import` với `client_max_body_size 16m` (mẫu `deploy/nginx-marine-english.conf`); thiếu thì tệp trên 5 MB bị nginx trả 413.
- Kiểm gói lớn trước khi tải: `node --import ./src/worker/alias-loader.mjs scripts/check-content-packages.ts <tệp…>`.
- Nút **Nghe** trong bài dùng giọng tiếng Anh có sẵn trên máy học viên (không gửi chữ ra ngoài); máy không có giọng tiếng Anh thì không hiện nút. Chưa có chấm phát âm.

## 6B. Quản trị quên mật khẩu (D3, từ 02/11/2026)

- Quản trị đăng nhập ở `/admin/dang-nhap` bằng email + mật khẩu. Quên mật khẩu hoặc chưa đặt: trên máy chủ chạy
  `cd ~/marine-english && ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml deploy/cli.sh deploy/prod.env admin:set-password <email>`.
  Lệnh in mật khẩu tạm **một lần** (không lưu ở đâu, chỉ lưu bản băm), đăng xuất mọi phiên của người đó và ghi nhật ký `cli_set_password`.
  Đưa mật khẩu tạm qua kênh riêng, người đó đăng nhập rồi đổi ngay ở mục **Mật khẩu**.
- Hoặc in link đăng nhập (`admin:login-link <email>`), vào bằng link rồi tự đặt mật khẩu ở mục **Mật khẩu**.

## 7A. Học viên quên mật khẩu (đăng nhập bằng số + mật khẩu)

- Học viên có email đã liên kết: tự làm ở màn đăng nhập, “Quên mật khẩu?”, mã gửi tới email đó.
- Không có email, hoặc mất số: chỉ **chủ** làm, ở Quản trị → Học viên → “Đặt mật khẩu tạm” (cần đăng nhập quản trị trong 10 phút gần đây).
  Trước khi bấm, đối chiếu đúng người theo G15: mã đơn, giao dịch chuyển khoản đã mua, thông tin hồ sơ. Ghi lý do và bằng chứng (bắt buộc).
  Mật khẩu tạm chỉ hiện một lần: đọc cho học viên; học viên phải đặt mật khẩu mới ở lần đăng nhập đầu. Mọi máy của học viên bị đăng xuất.
  Đổi số cho học viên: nhập số mới trong cùng hộp thoại (số không được thuộc tài khoản khác).
- Trang học viên ghi “Đã bị nhả” khi người khác đã xác minh số đó: học viên không còn đăng nhập được bằng số này, cần gắn số mới như trên.
- Job `me.auth.prune-password-attempts` (04:10 hằng ngày) xóa lượt thử mật khẩu quá 30 ngày.

## 8. Trước khi ra mắt (G8)

- [ ] Chọn VPS, đặt giới hạn CPU/RAM trong `docker-compose.prod.yml` theo cấu hình thật.
- [ ] Tên miền trỏ về máy chủ; HTTPS chạy.
- [ ] Tường lửa 80/443 + SSH bằng khóa; NTP; cập nhật bảo mật tự động; cảnh báo RAM/CPU của nhà cung cấp VPS.
- [ ] Cấu hình Telegram (`TELEGRAM_*`), **gửi thử một cảnh báo tới nhóm lỗi** và xác nhận có người nhận khi chủ ở biển.
- [ ] Nút duyệt trên Telegram (03/11/2026): đặt `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) và `TELEGRAM_APPROVERS=<id Telegram của chủ>:<email tài khoản chủ>` trong `prod.env`, khởi động lại `app`, rồi đăng ký webhook một lần:
  `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d url=https://<tên miền>/api/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET -d 'allowed_updates=["callback_query"]'`.
  Id Telegram của chủ: chủ nhắn bot một tin, rồi xem `getUpdates` trước khi đăng ký webhook (đăng ký xong thì `getUpdates` không trả nữa). Chỉ người trong danh sách, bấm trong nhóm `TELEGRAM_BUSINESS_CHAT_ID`, và email đó đang là chủ hoạt động mới duyệt được; bấm hai lần (chọn rồi "Chắc chắn"). Giờ chuyển ghi là lúc bấm.
- [ ] Nơi lưu ngoài (`BACKUP_RCLONE_REMOTE` + cấu hình rclone), chạy một lần sao lưu có `offsite: true`.
- [ ] Dịch vụ theo dõi bên ngoài gọi `/api/health` và `/api/health/worker`.
- [ ] Bản lưu ngoài máy của tệp env và khóa (mục 6).
- [ ] Thử khôi phục trên một máy khác, ghi vào bảng mục 5.
- [ ] Các mục nội dung và thanh toán trong `docs/noi-dung-can-chu-du-an.md`.
