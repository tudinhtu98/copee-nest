# Giải thích: Download hình ảnh từ Shopee và Upload lên WordPress

## Tổng quan Flow

```
Shopee URL (từ database) 
  ↓
Download hình ảnh (fetch từ Shopee CDN)
  ↓
Chuyển đổi thành Buffer/Blob
  ↓
Upload lên WordPress Media Library (REST API)
  ↓
Nhận URL mới từ WordPress
  ↓
Sử dụng URL mới khi tạo WooCommerce product
```

## Code chi tiết

### 1. Hàm `uploadImageToMediaLibrary()` 

**Location:** `copee-nest/src/products/products.service.ts` (dòng 469-503)
**Location:** `copee-nest/src/upload/upload.processor.ts` (dòng 263-300)

```typescript
private async uploadImageToMediaLibrary(site: any, imageUrl: string): Promise<string>
```

#### Bước 1: Chuẩn bị WordPress Media API endpoint

```typescript
const mediaEndpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
```

**Giải thích:**
- `site.baseUrl`: URL của WordPress site (ví dụ: `https://example.com`)
- `.replace(/\/$/, '')`: Loại bỏ dấu `/` ở cuối nếu có
- `/wp-json/wp/v2/media`: WordPress REST API endpoint cho media library
- **Kết quả:** `https://example.com/wp-json/wp/v2/media`

#### Bước 2: Tạo Basic Authentication

```typescript
const auth = Buffer.from(
  `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
).toString('base64');
```

**Giải thích:**
- WordPress REST API yêu cầu authentication để upload media
- Sử dụng WooCommerce API credentials (Consumer Key & Secret)
- Format: `username:password` → encode Base64
- **Ví dụ:** 
  - Input: `ck_abc123:cs_xyz789`
  - Base64: `Y2tfYWJjMTIzOmNzX3h5ejc4OQ==`
  - Header: `Authorization: Basic Y2tfYWJjMTIzOmNzX3h5ejc4OQ==`

#### Bước 3: Download hình ảnh từ Shopee

```typescript
// Download image
const imageRes = await fetch(imageUrl);
if (!imageRes.ok) {
  throw new Error(`Failed to download image: ${imageRes.status}`);
}
const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
```

**Giải thích:**
- `fetch(imageUrl)`: Gửi HTTP GET request đến Shopee CDN URL
  - Ví dụ: `https://cf.shopee.vn/file/abc123.jpg`
- `imageRes.ok`: Kiểm tra response status (200-299 = OK)
- `imageRes.arrayBuffer()`: Đọc response body dưới dạng binary data
- `Buffer.from(...)`: Chuyển đổi ArrayBuffer thành Node.js Buffer
  - Buffer là cách Node.js lưu trữ binary data trong memory
  - Cần thiết để upload file lên WordPress

**Lưu ý:**
- Nếu download fail (404, timeout, etc.) → throw error
- Error sẽ được catch ở bước upload và fallback về URL gốc

#### Bước 4: Lấy metadata hình ảnh

```typescript
const imageType = imageRes.headers.get('content-type') || 'image/jpeg';
const fileName = imageUrl.split('/').pop() || 'image.jpg';
```

**Giải thích:**
- `imageType`: Lấy MIME type từ response header
  - Ví dụ: `image/jpeg`, `image/png`, `image/webp`
  - Fallback: `image/jpeg` nếu không có
- `fileName`: Lấy tên file từ URL
  - `imageUrl.split('/')`: Tách URL thành array: `['https:', '', 'cf.shopee.vn', 'file', 'abc123.jpg']`
  - `.pop()`: Lấy phần tử cuối cùng: `'abc123.jpg'`
  - Fallback: `'image.jpg'` nếu không có

#### Bước 5: Tạo FormData để upload

```typescript
// Upload to WordPress media library
const formData = new FormData();
const blob = new Blob([imageBuffer], { type: imageType });
formData.append('file', blob, fileName);
```

**Giải thích:**
- `FormData`: Object để gửi multipart/form-data (giống như HTML form upload)
- `Blob([imageBuffer], { type: imageType })`: Tạo Blob từ Buffer
  - Blob = Binary Large Object, cách browser/Node.js xử lý file
  - `type`: MIME type để WordPress biết loại file
- `formData.append('file', blob, fileName)`: Thêm file vào form
  - `'file'`: Field name (WordPress API yêu cầu tên này)
  - `blob`: File data
  - `fileName`: Tên file hiển thị trong WordPress

**Lưu ý:** 
- Trong Node.js, `FormData` là global object (từ `undici` hoặc `form-data` package)
- Trong browser, `FormData` là built-in Web API

#### Bước 6: Upload lên WordPress

```typescript
const uploadRes = await fetch(mediaEndpoint, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${auth}`,
  },
  body: formData,
});

if (!uploadRes.ok) {
  throw new Error(`Failed to upload to media library: ${uploadRes.status}`);
}

const mediaData = await uploadRes.json();
return mediaData.source_url;
```

**Giải thích:**
- `fetch(mediaEndpoint, {...})`: Gửi POST request đến WordPress API
- `method: 'POST'`: HTTP method để upload file
- `headers.Authorization`: Basic Auth với credentials đã tạo ở Bước 2
- `body: formData`: Gửi FormData (chứa file) trong request body
- `uploadRes.json()`: Parse JSON response từ WordPress
- `mediaData.source_url`: URL của file đã upload lên WordPress
  - Ví dụ: `https://example.com/wp-content/uploads/2024/01/abc123.jpg`

**WordPress Response:**
```json
{
  "id": 123,
  "source_url": "https://example.com/wp-content/uploads/2024/01/abc123.jpg",
  "title": { "rendered": "abc123" },
  "mime_type": "image/jpeg",
  ...
}
```

### 2. Sử dụng trong `uploadToWoo()`

**Location:** `copee-nest/src/products/products.service.ts` (dòng 515-528)

```typescript
// Upload images to media library
let uploadedImages: { src: string; name?: string }[] = [];
if (Array.isArray(product.images) && product.images.length > 0) {
  for (const imgUrl of product.images) {
    try {
      const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
      uploadedImages.push({ src: mediaUrl });
    } catch (e) {
      console.warn(`Failed to upload image ${imgUrl}:`, e);
      // Fallback to original URL
      uploadedImages.push({ src: imgUrl });
    }
  }
}
```

**Giải thích:**
- `product.images`: Array các Shopee URLs từ database
  - Ví dụ: `['https://cf.shopee.vn/file/img1.jpg', 'https://cf.shopee.vn/file/img2.jpg']`
- Loop qua từng URL và upload:
  - **Success:** Lấy WordPress URL mới → `uploadedImages.push({ src: mediaUrl })`
  - **Error:** Fallback về Shopee URL gốc → `uploadedImages.push({ src: imgUrl })`
- **Kết quả:** Array các URLs (WordPress URLs hoặc Shopee URLs nếu upload fail)

**Lưu ý:**
- Upload từng hình một (sequential) để tránh quá tải
- Nếu một hình fail, vẫn tiếp tục upload các hình khác
- Fallback đảm bảo product vẫn có hình ảnh (dù là từ Shopee)

### 3. Sử dụng trong WooCommerce Product

```typescript
const body = {
  name: product.title || 'Copied product',
  type: 'simple',
  regular_price: product.price ? String(product.price) : undefined,
  description: product.description || undefined,
  categories: categoryArray,
  images: uploadedImages.length > 0 ? uploadedImages : undefined, // ← Sử dụng URLs đã upload
};
```

**Giải thích:**
- `images`: Array các object `{ src: string }`
- WooCommerce sẽ sử dụng URLs này để hiển thị hình ảnh sản phẩm
- Nếu upload thành công → URLs từ WordPress (ổn định, không phụ thuộc Shopee)
- Nếu upload fail → URLs từ Shopee (có thể bị broken nếu Shopee xóa)

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Product có images: ['https://cf.shopee.vn/file/img1.jpg'] │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Loop qua từng image URL                                  │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. fetch('https://cf.shopee.vn/file/img1.jpg')              │
│    → Download binary data                                    │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Buffer.from(arrayBuffer)                                  │
│    → Chuyển thành Buffer                                     │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. new Blob([buffer], { type: 'image/jpeg' })               │
│    → Tạo Blob từ Buffer                                      │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. FormData.append('file', blob, 'img1.jpg')               │
│    → Tạo multipart form data                                 │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. POST https://example.com/wp-json/wp/v2/media             │
│    Authorization: Basic Y2tfYWJjMTIz...                    │
│    Body: FormData (chứa file)                               │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. WordPress Response:                                      │
│    { source_url: 'https://example.com/wp-content/...' }    │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. uploadedImages.push({ src: WordPress_URL })            │
│    → Lưu URL mới vào array                                  │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. Tạo WooCommerce Product với images: uploadedImages     │
│     → Product có hình ảnh từ WordPress (không phụ thuộc Shopee)│
└─────────────────────────────────────────────────────────────┘
```

## Lợi ích của cách này

1. **Độc lập với Shopee:** Hình ảnh được lưu trên WordPress, không bị ảnh hưởng nếu Shopee xóa
2. **Performance:** WordPress có thể optimize hình ảnh (resize, compress, CDN)
3. **Reliability:** Nếu download fail, vẫn fallback về Shopee URL
4. **SEO:** URLs từ WordPress domain (tốt hơn cho SEO)

## Error Handling

```typescript
try {
  const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
  uploadedImages.push({ src: mediaUrl }); // ✅ Success: WordPress URL
} catch (e) {
  console.warn(`Failed to upload image ${imgUrl}:`, e);
  uploadedImages.push({ src: imgUrl }); // ⚠️ Fallback: Shopee URL
}
```

**Các trường hợp có thể fail:**
- Shopee URL không tồn tại (404)
- Network timeout
- WordPress API authentication fail
- WordPress server error (500)
- File quá lớn

**Fallback strategy:** Luôn có hình ảnh (dù là từ Shopee) để product không bị thiếu hình.

