-- Affiliate ID chuyển hẳn về tài khoản user. Backfill trước để không mất dữ liệu:
-- user nào chưa có aff id thì lấy aff id từ site đầu tiên của họ có cấu hình.
UPDATE "users" u
SET "shopee_affiliate_id" = s."shopee_affiliate_id"
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "shopee_affiliate_id"
  FROM "sites"
  WHERE "shopee_affiliate_id" IS NOT NULL AND btrim("shopee_affiliate_id") <> ''
  ORDER BY "user_id", "created_at" ASC
) s
WHERE u."id" = s."user_id"
  AND (u."shopee_affiliate_id" IS NULL OR btrim(u."shopee_affiliate_id") = '');

-- DropColumn
ALTER TABLE "sites" DROP COLUMN "shopee_affiliate_id";
