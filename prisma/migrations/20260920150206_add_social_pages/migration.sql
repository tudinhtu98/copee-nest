-- CreateEnum
CREATE TYPE "public"."SocialPlatform" AS ENUM ('FACEBOOK');

-- CreateEnum
CREATE TYPE "public"."ConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH');

-- CreateEnum
CREATE TYPE "public"."MediaSource" AS ENUM ('UPLOAD', 'AI_GENERATED', 'PRODUCT');

-- CreateEnum
CREATE TYPE "public"."ContentPostStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."social_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "public"."SocialPlatform" NOT NULL DEFAULT 'FACEBOOK',
    "external_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "public"."ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."facebook_pages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "picture_url" TEXT,
    "encrypted" TEXT NOT NULL,
    "tasks" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "public"."MediaSource" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "prompt" TEXT,
    "model" TEXT,
    "product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_posts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "page_id" TEXT,
    "product_id" TEXT,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "media_ids" TEXT[],
    "status" "public"."ContentPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "external_post_id" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_user_id_platform_external_user_id_key" ON "public"."social_connections"("user_id", "platform", "external_user_id");

-- CreateIndex
CREATE INDEX "facebook_pages_connection_id_idx" ON "public"."facebook_pages"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_pages_user_id_external_id_key" ON "public"."facebook_pages"("user_id", "external_id");

-- CreateIndex
CREATE INDEX "media_assets_user_id_created_at_idx" ON "public"."media_assets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "content_posts_user_id_status_updated_at_idx" ON "public"."content_posts"("user_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_posts_user_id_external_post_id_key" ON "public"."content_posts"("user_id", "external_post_id");

-- AddForeignKey
ALTER TABLE "public"."social_connections" ADD CONSTRAINT "social_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facebook_pages" ADD CONSTRAINT "facebook_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facebook_pages" ADD CONSTRAINT "facebook_pages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_assets" ADD CONSTRAINT "media_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_posts" ADD CONSTRAINT "content_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_posts" ADD CONSTRAINT "content_posts_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."facebook_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

