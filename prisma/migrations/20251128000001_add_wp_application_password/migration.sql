-- AlterTable: sites - add WordPress Application Password fields
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sites' AND column_name = 'wp_username'
    ) THEN
        ALTER TABLE "sites" ADD COLUMN "wp_username" TEXT;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sites' AND column_name = 'wp_application_password'
    ) THEN
        ALTER TABLE "sites" ADD COLUMN "wp_application_password" TEXT;
    END IF;
END $$;

