-- Settings → App Settings (owner, 2026-11-12): low-sensitivity ids (WhatsApp
-- number ids, WABA id, Meta app id, OTP template) set from the app; blank keys
-- fall back to .env. Secrets stay in Vercel.
ALTER TABLE "OrgDefaults" ADD COLUMN "appSettingsJson" JSONB NOT NULL DEFAULT '{}';
