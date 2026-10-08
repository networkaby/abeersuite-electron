-- WhatsApp attachments: the file sits in the private R2 bucket; the row keeps
-- its key, type, name and size. Null = a text-only message.
ALTER TABLE "Message" ADD COLUMN "mediaKey" TEXT,
ADD COLUMN "mediaType" TEXT,
ADD COLUMN "fileName" TEXT,
ADD COLUMN "mediaSize" INTEGER;
