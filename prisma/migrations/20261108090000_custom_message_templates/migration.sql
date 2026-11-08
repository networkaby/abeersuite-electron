-- Staff can add their own WhatsApp / Email templates beside the built-in kinds
-- (owner, 2026-11-08). A custom row's kind is CUSTOM_<id>; name is what staff
-- called it. Built-in rows keep name NULL — their label lives in code.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "name" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN "name" TEXT;
