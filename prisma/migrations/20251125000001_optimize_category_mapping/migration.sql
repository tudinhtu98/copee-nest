-- AlterTable: category_mappings - make target_id and target_name nullable
-- These fields are now auto-populated from WooCommerceCategory

DO $$ 
BEGIN
    -- Make target_id nullable
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'category_mappings' 
        AND column_name = 'target_id' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "category_mappings" 
        ALTER COLUMN "target_id" DROP NOT NULL;
    END IF;

    -- Make target_name nullable
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'category_mappings' 
        AND column_name = 'target_name' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "category_mappings" 
        ALTER COLUMN "target_name" DROP NOT NULL;
    END IF;
END $$;

-- Auto-populate target_id and target_name from WooCommerceCategory for existing mappings
UPDATE "category_mappings" cm
SET 
    "target_id" = wc."woo_id",
    "target_name" = wc."name"
FROM "woocommerce_categories" wc
WHERE cm."woo_category_id" = wc."id"
  AND (cm."target_id" IS NULL OR cm."target_name" IS NULL);

