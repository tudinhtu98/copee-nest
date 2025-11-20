# Kế hoạch: Upload sản phẩm có hình lên WooCommerce

## 📋 Tổng quan

Để upload sản phẩm có hình ảnh lên WooCommerce thành công, cần đảm bảo các điều kiện sau:

## 🔑 Điều kiện bắt buộc

### 1. WordPress REST API phải được bật
- **Kiểm tra:** Truy cập `https://your-site.com/wp-json/wp/v2/media`
- **Kết quả mong đợi:** Trả về JSON (có thể là 401/403 nếu chưa auth, nhưng không phải 404)
- **Nếu 404:** Cần enable REST API trong WordPress

### 2. Authentication credentials

#### Option A: WooCommerce API Keys (hiện tại đang dùng)
- **Yêu cầu:**
  - WooCommerce Consumer Key (bắt đầu với `ck_`)
  - WooCommerce Consumer Secret (bắt đầu với `cs_`)
- **Vấn đề:** Một số WordPress site không chấp nhận WooCommerce keys cho REST API
- **Giải pháp:** Chuyển sang Option B nếu gặp lỗi 401/403

#### Option B: WordPress Application Password (Khuyến nghị)
- **Cách tạo:**
  1. WordPress Admin → Users → Profile
  2. Scroll xuống "Application Passwords"
  3. Tạo password mới (ví dụ: "Copee Upload")
  4. Copy password (chỉ hiển thị 1 lần)
- **Format:** `username:application_password`
- **Ví dụ:** `admin:xxxx xxxx xxxx xxxx xxxx xxxx`
- **Lưu ý:** Cần lưu cả username và application password

### 3. Quyền người dùng WordPress
- **Yêu cầu tối thiểu:** `Author` role (có thể upload media)
- **Khuyến nghị:** `Editor` hoặc `Administrator`
- **Kiểm tra:** User phải có quyền `upload_files` capability

### 4. Cấu hình WordPress

#### a. File Upload Size Limits
- **PHP `upload_max_filesize`:** Tối thiểu 10MB (khuyến nghị 20MB)
- **PHP `post_max_size`:** Tối thiểu 10MB (khuyến nghị 20MB)
- **WordPress Media Settings:** Không giới hạn hoặc ≥ 10MB
- **Kiểm tra:** WordPress Admin → Settings → Media

#### b. MIME Types được phép
- **Mặc định WordPress cho phép:**
  - `image/jpeg`
  - `image/png`
  - `image/gif`
  - `image/webp`
- **Nếu cần thêm:** Dùng plugin hoặc filter `upload_mimes`

#### c. Storage Space
- **Yêu cầu:** Đủ dung lượng trên server để lưu hình ảnh
- **Ước tính:** Mỗi sản phẩm có thể có 3-10 hình, mỗi hình ~500KB-2MB

### 5. Network & Server

#### a. Download từ Shopee
- **Timeout:** 30 giây mỗi hình (đã cấu hình)
- **Retry:** 3 lần với exponential backoff
- **Headers:** User-Agent, Accept, Referer (để tránh bị block)
- **Vấn đề có thể gặp:**
  - Shopee CDN chặn requests từ server
  - Network timeout
  - Image URL không còn tồn tại (404)

#### b. Upload lên WordPress
- **Timeout:** Mặc định của fetch (không có explicit timeout)
- **Vấn đề có thể gặp:**
  - WordPress server chậm
  - File quá lớn
  - Server hết storage

## 🛠️ Kế hoạch triển khai

### Phase 1: Cải thiện Authentication (Ưu tiên cao)

#### 1.1. Thêm Application Password support
- **File:** `copee-nest/src/upload/upload.processor.ts`
- **Thay đổi:**
  - Thêm field `wpApplicationPassword` vào Site model (optional)
  - Nếu có `wpApplicationPassword` → dùng Application Password
  - Nếu không → fallback về WooCommerce keys
- **Database:**
  ```sql
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS wp_application_password TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS wp_username TEXT;
  ```
- **Frontend:** Thêm input fields trong Settings page để nhập Application Password

#### 1.2. Cải thiện error messages
- Hiển thị rõ ràng lỗi authentication
- Gợi ý chuyển sang Application Password nếu gặp 401/403

### Phase 2: Cải thiện Upload Logic (Ưu tiên trung bình)

#### 2.1. Thêm timeout cho WordPress upload
- Hiện tại chỉ có timeout cho download từ Shopee
- Cần thêm timeout cho upload lên WordPress (60 giây)

#### 2.2. Parallel upload (tùy chọn)
- Hiện tại upload tuần tự (sequential)
- Có thể upload song song 2-3 hình để tăng tốc
- **Lưu ý:** Không quá nhiều để tránh quá tải server

#### 2.3. Validate image trước khi upload
- Kiểm tra file size
- Kiểm tra MIME type
- Validate image format (JPEG, PNG, WebP)

### Phase 3: Fallback Strategy (Ưu tiên thấp)

#### 3.1. Retry với different strategy
- Nếu Application Password fail → thử WooCommerce keys
- Nếu upload fail → thử upload lại sau 5 phút

#### 3.2. Alternative: Direct URL (tạm thời)
- Nếu upload fail hoàn toàn → có thể dùng Shopee URL trực tiếp
- **Lưu ý:** WooCommerce có thể timeout khi download từ Shopee
- **Giải pháp:** Dùng plugin để proxy images hoặc CDN

### Phase 4: Monitoring & Logging (Ưu tiên trung bình)

#### 4.1. Thêm metrics
- Tỷ lệ thành công upload images
- Thời gian trung bình upload mỗi hình
- Số lần retry trung bình

#### 4.2. Alerting
- Gửi email/notification nếu tỷ lệ fail > 20%
- Log chi tiết các lỗi thường gặp

## 📝 Checklist cho User

Khi setup WordPress site trong Copee, user cần:

- [ ] **WooCommerce đã được cài đặt và kích hoạt**
- [ ] **Tạo WooCommerce API keys:**
  - WooCommerce → Settings → Advanced → REST API
  - Tạo key mới với quyền Read/Write
  - Copy Consumer Key và Consumer Secret
- [ ] **Kiểm tra WordPress REST API:**
  - Truy cập `https://your-site.com/wp-json/wp/v2/media`
  - Phải trả về JSON (không phải 404)
- [ ] **Tạo Application Password (Khuyến nghị):**
  - WordPress Admin → Users → Profile
  - Application Passwords → Tạo mới
  - Copy username và password
- [ ] **Kiểm tra quyền user:**
  - User phải có quyền upload media (Author trở lên)
- [ ] **Kiểm tra file size limits:**
  - PHP `upload_max_filesize` ≥ 10MB
  - PHP `post_max_size` ≥ 10MB
- [ ] **Kiểm tra storage:**
  - Đảm bảo có đủ dung lượng trên server

## 🔍 Debugging

### Lỗi thường gặp:

1. **401 Unauthorized / 403 Forbidden**
   - **Nguyên nhân:** Authentication sai hoặc không đủ quyền
   - **Giải pháp:** Dùng Application Password thay vì WooCommerce keys

2. **413 Request Entity Too Large**
   - **Nguyên nhân:** File quá lớn
   - **Giải pháp:** Tăng `upload_max_filesize` và `post_max_size` trong PHP

3. **415 Unsupported Media Type**
   - **Nguyên nhân:** WordPress không chấp nhận MIME type
   - **Giải pháp:** Kiểm tra `upload_mimes` filter

4. **Timeout khi download từ Shopee**
   - **Nguyên nhân:** Shopee CDN chậm hoặc block requests
   - **Giải pháp:** Đã có retry logic, có thể cần tăng timeout

5. **Timeout khi upload lên WordPress**
   - **Nguyên nhân:** WordPress server chậm hoặc file quá lớn
   - **Giải pháp:** Tăng timeout, optimize images trước khi upload

## 🎯 Kết quả mong đợi

Sau khi triển khai:
- ✅ Tỷ lệ thành công upload images ≥ 90%
- ✅ Thời gian upload mỗi hình < 10 giây
- ✅ Product có ít nhất 1 hình ảnh sau khi upload
- ✅ User có thể tự debug và fix lỗi authentication

## 📅 Timeline đề xuất

- **Week 1:** Phase 1 (Application Password support)
- **Week 2:** Phase 2 (Cải thiện upload logic)
- **Week 3:** Phase 3 (Fallback strategy) + Phase 4 (Monitoring)

