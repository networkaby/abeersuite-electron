-- Which of our WhatsApp numbers a message went through, so a reply goes back
-- out from the number the customer wrote to. Null = the main number.
ALTER TABLE "Message" ADD COLUMN "businessNumberId" TEXT,
ADD COLUMN "businessNumber" TEXT;
