-- Add shopee_affiliate_id column to sites table
ALTER TABLE sites ADD COLUMN IF NOT EXISTS shopee_affiliate_id TEXT;
