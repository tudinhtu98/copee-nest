-- AlterTable
ALTER TABLE "public"."products" RENAME CONSTRAINT "Product_pkey" TO "products_pkey";

-- AlterTable
ALTER TABLE "public"."sites" RENAME CONSTRAINT "Site_pkey" TO "sites_pkey";

-- AlterTable
ALTER TABLE "public"."transactions" RENAME CONSTRAINT "Transaction_pkey" TO "transactions_pkey";

-- AlterTable
ALTER TABLE "public"."upload_jobs" RENAME CONSTRAINT "UploadJob_pkey" TO "upload_jobs_pkey";

-- AlterTable
ALTER TABLE "public"."users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
