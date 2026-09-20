# copee-nest — API của copee

NestJS 11 + Prisma 6 + PostgreSQL + Redis (BullMQ). Chạy cùng
[copee-next](https://github.com/tudinhtu98/copee-next) (giao diện) và copee-chrome-extension.

Production: API cổng **4000** sau nginx tại `https://api.copee.vn`, web cổng **3001**
tại `https://app.copee.vn`.

---

## Chạy ở máy

Cần **Node 22**, **PostgreSQL**, **Redis**.

```bash
npm ci
cp .env.production.example .env   # rồi sửa cho môi trường máy
npx prisma migrate dev            # tạo bảng + sinh Prisma Client
npm run dev                       # http://localhost:4000
```

> ⚠️ **Để trống `TELEGRAM_BOT_TOKEN` và `VIDEO_BOT_TOKEN` khi chạy ở máy.**
> Có token thật thì bản dev sẽ tranh tin nhắn với bot đang chạy trên server —
> người dùng thật gửi lệnh mà máy mình xử lý, còn server thì im.

### Lệnh hay dùng

| Lệnh | Việc |
|---|---|
| `npm run dev` | chạy có watch |
| `npm test` | chạy test (jest) |
| `npx tsc -p tsconfig.json --noEmit` | kiểm tra kiểu |
| `npm run build` | build ra `dist/` |
| `npm run seed` | nạp dữ liệu mẫu |
| `npx prisma studio` | xem/sửa database bằng giao diện |

---

## Biến môi trường

Danh sách đầy đủ kèm giải thích nằm trong **`.env.production.example`** — sửa gì thì
cập nhật luôn file đó. Vài điểm cần nhớ:

**Bắt buộc để app chạy:** `DATABASE_URL`, `JWT_SECRET`, `PORT`,
`REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`.

**Nhóm AI + fanpage** (`ENCRYPTION_KEYS`, `META_APP_ID`, `GEMINI_API_KEY`,
`PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `MEDIA_DIR`): thiếu thì **app vẫn khởi động bình
thường**, chỉ riêng màn hình Fanpage và trợ lý AI báo lỗi khi dùng. Deploy trước rồi
bổ sung sau cũng được.

> ⚠️ **`ENCRYPTION_KEYS` là khoá một chiều với dữ liệu đã lưu.** Đổi hoặc mất khoá là
> **không giải mã lại được** token Facebook nào đã lưu — mọi người phải kết nối lại
> từ đầu. Cất chung chỗ với các secret khác, và đừng dùng chung khoá giữa dev với
> production. Muốn đổi khoá mà không mất dữ liệu cũ thì **thêm** khoá mới vào danh
> sách rồi tăng `ENCRYPTION_ACTIVE_KEY_VERSION`, đừng thay khoá cũ:
> ```
> ENCRYPTION_KEYS=1:<khoá cũ>,2:<khoá mới>
> ENCRYPTION_ACTIVE_KEY_VERSION=2
> ```

> `AI_CHAT_MODEL` mặc định là đời Gemini mới hơn model viết bài — **có lý do**: model
> 2.5 không chịu gọi công cụ nối tiếp nhau, nó dừng lại hỏi người dùng "cho tôi id sản
> phẩm" thay vì tự tra. Hạ model ở đây là trợ lý AI ngu hẳn đi.

---

## Cấu trúc

Mỗi thư mục trong `src/` là một module Nest:

| Thư mục | Nội dung |
|---|---|
| `auth`, `users`, `api-keys` | đăng nhập, JWT, API key cho extension và agent MCP |
| `products`, `sites`, `shopee`, `upload` | sản phẩm copy về, đẩy lên WordPress |
| `billing` | điểm và lịch sử giao dịch |
| `video`, `video-bot` | dựng video sản phẩm, bot Telegram nhận video |
| `social` | kết nối Facebook, thư viện ảnh, soạn/đăng/hẹn giờ bài fanpage |
| `ai` | viết nội dung, tạo ảnh, trợ lý chat, MCP server |
| `settings` | cấu hình sửa được trong trang admin (giá điểm, model video…) |
| `admin`, `audit-log` | quản trị và nhật ký thao tác |

### Ba quy ước phải biết trước khi sửa code

**1. Việc ghi của AI luôn đi qua đề xuất → xác nhận.**
Trợ lý chat và agent MCP **không tự thực hiện** việc tốn điểm hay khó hoàn tác. Chúng
tạo một `AiAction` trạng thái `PROPOSED`, người dùng bấm Xác nhận trên giao diện thì
mới chạy. Đề xuất hết hạn sau 15 phút và chỉ chạy được đúng một lần. Chat **không thể
tự xác nhận đề xuất của chính nó**, kể cả khi model bịa ra tên công cụ đó. Thêm việc
mới mà tốn điểm thì khai báo trong `src/ai/actions.service.ts`, đừng làm thẳng trong
công cụ.

**2. Trừ điểm phải làm bằng UPDATE có điều kiện.**

```ts
const claimed = await tx.user.updateMany({
  where: { id: userId, balance: { gte: amount } },
  data: { balance: { decrement: amount } },
});
if (!claimed.count) throw new BadRequestException('Số dư không đủ');
```

Đọc số dư rồi mới trừ ở câu lệnh khác là **sai** — hai yêu cầu song song cùng đọc được
số dư cũ và tiêu quá tay. Đã từng dính: trừ 700 hai lần trên số dư 1000 đều qua, số dư
còn −400. Có test giữ lại trong `src/billing/billing.service.spec.ts`.

**3. Lỗi token Facebook phải trả 409, không phải 401.**
`MetaAuthError` kế thừa `ConflictException` (409) với mã `META_REAUTH_REQUIRED`. Trả
401 thì giao diện tưởng phiên đăng nhập copee hết hạn và **đá người dùng ra màn hình
đăng nhập**, dù thứ hết hạn chỉ là token Facebook.

---

## Database và migration

```bash
npx prisma migrate dev --name <tên_việc>   # ở máy: tạo migration mới
npx prisma migrate deploy                  # trên server: chỉ áp dụng, không sinh thêm
npx prisma migrate status                  # xem còn migration nào chưa chạy
```

> ⚠️ **Nếu `migrate dev` đòi reset database, ĐỪNG đồng ý** — nó xoá sạch dữ liệu. Việc
> này xảy ra khi database thật lệch với lịch sử migration (drift). Cách xử lý mà vẫn
> giữ nguyên dữ liệu:
>
> ```bash
> # 1. Xem chính xác SQL cần chạy
> npx prisma migrate diff \
>   --from-url "$DATABASE_URL" \
>   --to-schema-datamodel prisma/schema.prisma \
>   --script > /tmp/thay-doi.sql
>
> # 2. ĐỌC file đó. Có DROP TABLE / DROP COLUMN nào không?
> #    Có thì dừng lại xem lại schema, đừng chạy tiếp.
>
> # 3. Tự chạy tay
> psql "$DATABASE_URL" -f /tmp/thay-doi.sql
>
> # 4. Báo cho Prisma biết migration đó đã chạy rồi
> npx prisma migrate resolve --applied <tên_thư_mục_migration>
> ```
>
> Migration sinh bằng `migrate diff` sẽ gom cả những chỗ lệch có sẵn từ trước, không
> chỉ thay đổi mình vừa làm. **Đọc hết file SQL trước khi commit.**

---

## `.npmrc` — đừng xoá

Repo có `.npmrc` đặt `legacy-peer-deps=false`. Đây **không phải** thứ thừa: vài máy
trong nhóm bật `legacy-peer-deps=true` trong `~/.npmrc`; npm khi đó bỏ qua
`peerDependencies` lúc dựng cây phụ thuộc, nên `package-lock.json` sinh ra ở máy đó
khác cây mà CI dựng, và `npm ci` trên CI gãy với lỗi kiểu "lock file's X does not
satisfy Y". File này bắt mọi máy và CI theo cùng một luật. Bên copee-next đã dính lỗi
này một lần.

---

## CI

`.github/workflows/ci.yml` chạy khi đẩy lên `main`, khi mở PR, hoặc bấm tay:
`npm ci` → `prisma generate` → kiểm tra kiểu → test → build.

**Chưa bật lint**: `npm run lint` hiện báo hơn 1.600 lỗi có sẵn (phần lớn là prettier
và `no-unsafe-*` trong `src/video`, `src/telegram`). Dọn xong thì thêm bước chạy
`npx eslint "{src,test}/**/*.ts"` — **không kèm `--fix`**, vì script `lint` sẵn có tự
sửa file, không hợp với CI.

CI cũng **không** chạy `npm run test:e2e`: file đó khởi động nguyên `AppModule`, tức là
bật cả bot Telegram bằng token thật.

---

## Deploy lên server

### Chuẩn bị một lần

1. **Thư mục ảnh**, đặt ngoài thư mục deploy để build lại không mất:
   ```bash
   sudo mkdir -p /var/lib/copee/media
   U=$(systemctl show -p User --value copee-backend)
   sudo chown -R "$U:$U" /var/lib/copee
   ```
   (khớp với `MEDIA_DIR` trong `.env.production.example`)

2. **Giới hạn upload của nginx.** Ảnh cho phép tới **8MB**, nginx mặc định chỉ **1MB**
   nên upload sẽ lỗi 413. Thêm vào cả khối `server` của web lẫn của api:
   ```nginx
   client_max_body_size 12m;
   ```
   rồi `sudo nginx -t && sudo systemctl reload nginx`.

3. **Facebook App**: thêm Valid OAuth Redirect URI
   `https://api.copee.vn/social/facebook/callback`, xin các quyền `pages_show_list`,
   `pages_read_engagement`, `pages_read_user_content`, `pages_manage_posts`.
   Thiếu `pages_read_user_content` thì không đọc được bài có sẵn trên Page
   (Facebook báo lỗi `(#10)`).

4. **Gemini**: bật thanh toán cho API key nếu muốn dùng AI tạo ảnh và video — các
   model này không có hạn mức miễn phí.

### Mỗi lần deploy

Sao lưu trước nếu lần này có migration:

```bash
sudo -u postgres pg_dump copee > ~/copee-$(date +%F-%H%M).sql
chmod 600 ~/copee-*.sql
```

Đổi `copee` thành tên database thật — là đoạn cuối của `DATABASE_URL` trong `.env`.

> **Đừng chạy `pg_dump "$DATABASE_URL"` thẳng trên server.** Biến đó chỉ nằm trong
> `.env`, không có trong shell, nên lệnh thành `pg_dump ""` và Postgres quay về mặc
> định: hỏi mật khẩu của user trùng tên user Linux đang đăng nhập (thường là `root`),
> mà user Postgres đó không tồn tại nên nhập gì cũng không vào.
>
> Chạy `sudo -u postgres` thì Postgres tin theo user hệ điều hành, khỏi mật khẩu. Nếu
> vẫn muốn dùng đúng `DATABASE_URL` thì nạp file trước — nhưng cách này đưa cả token
> Telegram và khoá mã hoá vào shell, xong việc nhớ thoát shell đó ra:
> ```bash
> cd /var/www/copee/backend && set -a; . ./.env; set +a
> ```
>
> File dump chứa mật khẩu đã băm và token Facebook đã mã hoá của toàn bộ người dùng.
> Để quyền `600` và đừng bỏ quên nó trong thư mục home.

**Backend trước, frontend sau** — web gọi API, làm ngược lại thì web lỗi 404 một lúc.

```bash
cd /var/www/copee/backend
git pull
npm ci                     # bắt buộc: có phụ thuộc native (sharp) phải cài trên server
npx prisma generate        # bắt buộc: dự án không có postinstall, client cũ không biết bảng mới
npx prisma migrate deploy
npm run build
sudo systemctl restart copee-backend
```

Ba bước `npm ci`, `prisma generate`, `migrate deploy` **không được bỏ** khi lần deploy
đó có thêm phụ thuộc hoặc đổi schema. Bỏ `prisma generate` thì app build xong vẫn chết
lúc chạy vì client cũ không biết model mới.

Rồi sang copee-next và làm theo README của repo đó.

### Kiểm tra sau khi deploy

```bash
systemctl status copee-backend --no-pager
journalctl -u copee-backend -n 50 --no-pager
curl -sS https://api.copee.vn/social/connections -o /dev/null -w '%{http_code}\n'   # mong đợi 401
```

Rồi mở `https://app.copee.vn/dashboard/fanpage` và thử tải một ảnh lên — bước này kiểm
luôn cả nginx, `MEDIA_DIR` và quyền thư mục.
