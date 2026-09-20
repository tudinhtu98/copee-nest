-- CreateEnum
CREATE TYPE "public"."AiActionKind" AS ENUM ('PUBLISH_POST', 'DELETE_PAGE_POST', 'GENERATE_IMAGE', 'CREATE_VIDEO', 'UPLOAD_PRODUCT');

-- CreateEnum
CREATE TYPE "public"."AiActionStatus" AS ENUM ('PROPOSED', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."AiActionSource" AS ENUM ('CHAT', 'MCP', 'UI');

-- AlterTable
ALTER TABLE "public"."api_keys" ALTER COLUMN "permissions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."users" ALTER COLUMN "balance" SET DEFAULT 10000;

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "cost" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "public"."AiActionSource" NOT NULL,
    "kind" "public"."AiActionKind" NOT NULL,
    "status" "public"."AiActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "chat_message_id" TEXT,
    "api_key_id" TEXT,
    "summary" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "cost_points" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_user_id_updated_at_idx" ON "public"."conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "public"."chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_user_id_created_at_idx" ON "public"."ai_actions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_chat_message_id_idx" ON "public"."ai_actions"("chat_message_id");

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_actions" ADD CONSTRAINT "ai_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_actions" ADD CONSTRAINT "ai_actions_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

