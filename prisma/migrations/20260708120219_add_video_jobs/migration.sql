-- Thêm liên kết Telegram cho user
ALTER TABLE "users" ADD COLUMN "telegram_id" TEXT;
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- Bảng job tạo video từ sản phẩm
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "style" TEXT NOT NULL DEFAULT 'default',
    "caption" TEXT,
    "video_url" TEXT,
    "duration_sec" INTEGER,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "video_jobs_user_id_idx" ON "video_jobs"("user_id");
CREATE INDEX "video_jobs_status_idx" ON "video_jobs"("status");
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
