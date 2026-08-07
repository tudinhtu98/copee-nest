-- AlterTable: affiliate ID Shopee lưu ở tài khoản user
ALTER TABLE "users" ADD COLUMN "shopee_affiliate_id" TEXT;

-- AlterTable: link affiliate đã tạo cho từng sản phẩm
ALTER TABLE "products" ADD COLUMN "affiliate_url" TEXT;
ALTER TABLE "products" ADD COLUMN "affiliate_sub_id" TEXT;
