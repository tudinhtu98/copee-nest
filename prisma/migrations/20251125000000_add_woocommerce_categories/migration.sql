-- CreateTable: woocommerce_categories
CREATE TABLE IF NOT EXISTS "woocommerce_categories" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "woo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "parent_id" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "woocommerce_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique site_id + woo_id
CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_categories_site_id_woo_id_key" ON "woocommerce_categories"("site_id", "woo_id");

-- AddForeignKey: woocommerce_categories.site_id -> sites.id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'woocommerce_categories_site_id_fkey'
    ) THEN
        ALTER TABLE "woocommerce_categories" 
        ADD CONSTRAINT "woocommerce_categories_site_id_fkey" 
        FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable: products - add category_id column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'category_id'
    ) THEN
        ALTER TABLE "products" ADD COLUMN "category_id" TEXT;
    END IF;
END $$;

-- AlterTable: products - add needs_mapping column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'needs_mapping'
    ) THEN
        ALTER TABLE "products" ADD COLUMN "needs_mapping" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- AlterTable: category_mappings - add woo_category_id column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'category_mappings' AND column_name = 'woo_category_id'
    ) THEN
        ALTER TABLE "category_mappings" ADD COLUMN "woo_category_id" TEXT;
    END IF;
END $$;

-- AddForeignKey: category_mappings.woo_category_id -> woocommerce_categories.id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'category_mappings_woo_category_id_fkey'
    ) THEN
        ALTER TABLE "category_mappings" 
        ADD CONSTRAINT "category_mappings_woo_category_id_fkey" 
        FOREIGN KEY ("woo_category_id") REFERENCES "woocommerce_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

