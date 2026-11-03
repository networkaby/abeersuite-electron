-- Team chat attachments: a file in the private R2 bucket, null = text only.
ALTER TABLE "ChatMessage" ADD COLUMN "mediaKey" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "mediaType" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "fileName" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "mediaSize" INTEGER;
