-- Add retry_count column to upload_jobs table
ALTER TABLE upload_jobs
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;
