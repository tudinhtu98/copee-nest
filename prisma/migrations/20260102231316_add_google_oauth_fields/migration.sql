-- AlterTable
ALTER TABLE "users"
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "google_id" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "image" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_id_key" ON "users"("google_id");
