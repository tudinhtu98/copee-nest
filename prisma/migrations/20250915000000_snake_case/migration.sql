-- Drop existing foreign key constraints before renaming tables/columns
ALTER TABLE "public"."Site" DROP CONSTRAINT "Site_userId_fkey";
ALTER TABLE "public"."Product" DROP CONSTRAINT "Product_userId_fkey";
ALTER TABLE "public"."UploadJob" DROP CONSTRAINT "UploadJob_productId_fkey";
ALTER TABLE "public"."UploadJob" DROP CONSTRAINT "UploadJob_siteId_fkey";
ALTER TABLE "public"."Transaction" DROP CONSTRAINT "Transaction_userId_fkey";

-- Rename tables to snake_case
ALTER TABLE "public"."User" RENAME TO "users";
ALTER TABLE "public"."Site" RENAME TO "sites";
ALTER TABLE "public"."Product" RENAME TO "products";
ALTER TABLE "public"."UploadJob" RENAME TO "upload_jobs";
ALTER TABLE "public"."Transaction" RENAME TO "transactions";

-- Rename columns on users table
ALTER TABLE "public"."users" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "public"."users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public"."users" RENAME COLUMN "updatedAt" TO "updated_at";

-- Rename columns on sites table
ALTER TABLE "public"."sites" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "public"."sites" RENAME COLUMN "baseUrl" TO "base_url";
ALTER TABLE "public"."sites" RENAME COLUMN "wooConsumerKey" TO "woo_consumer_key";
ALTER TABLE "public"."sites" RENAME COLUMN "wooConsumerSecret" TO "woo_consumer_secret";
ALTER TABLE "public"."sites" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public"."sites" RENAME COLUMN "updatedAt" TO "updated_at";

-- Rename columns on products table
ALTER TABLE "public"."products" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "public"."products" RENAME COLUMN "sourceShop" TO "source_shop";
ALTER TABLE "public"."products" RENAME COLUMN "sourceUrl" TO "source_url";
ALTER TABLE "public"."products" RENAME COLUMN "errorMessage" TO "error_message";
ALTER TABLE "public"."products" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public"."products" RENAME COLUMN "updatedAt" TO "updated_at";

-- Rename columns on upload_jobs table
ALTER TABLE "public"."upload_jobs" RENAME COLUMN "productId" TO "product_id";
ALTER TABLE "public"."upload_jobs" RENAME COLUMN "siteId" TO "site_id";
ALTER TABLE "public"."upload_jobs" RENAME COLUMN "targetCategory" TO "target_category";
ALTER TABLE "public"."upload_jobs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "public"."upload_jobs" RENAME COLUMN "updatedAt" TO "updated_at";

-- Rename columns on transactions table
ALTER TABLE "public"."transactions" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "public"."transactions" RENAME COLUMN "createdAt" TO "created_at";

-- Rename indexes to match new table names
ALTER INDEX "public"."User_email_key" RENAME TO "users_email_key";
ALTER INDEX "public"."User_username_key" RENAME TO "users_username_key";

-- Recreate foreign keys with snake_case identifiers
ALTER TABLE "public"."sites"
  ADD CONSTRAINT "sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."upload_jobs"
  ADD CONSTRAINT "upload_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."upload_jobs"
  ADD CONSTRAINT "upload_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."transactions"
  ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
