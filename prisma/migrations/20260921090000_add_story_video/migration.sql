-- Video kể chuyện ("một người nói chuyện"): không gắn sản phẩm, nên product_id được phép trống.
ALTER TABLE "video_jobs" ALTER COLUMN "product_id" DROP NOT NULL;

ALTER TABLE "video_jobs" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "video_jobs" ADD COLUMN "title" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "scenes" JSONB;
ALTER TABLE "video_jobs" ADD COLUMN "spoken_text" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "media_id" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "presenter" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "clips" INTEGER NOT NULL DEFAULT 1;
