-- AlterTable: products - add original_price column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'original_price'
    ) THEN
        ALTER TABLE "products" ADD COLUMN "original_price" INTEGER;
    END IF;
END $$;

