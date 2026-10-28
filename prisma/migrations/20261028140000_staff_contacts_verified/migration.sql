-- Every phone/email still unverified was entered by staff (new customer, new
-- company, import), which never set verifiedAt. Staff-entered contacts count
-- as verified, so mark them now. Data only: no schema change.
-- updatedAt moves too, so counter replicas pull the change.
UPDATE "Phone" SET "verifiedAt" = NOW(), "updatedAt" = NOW() WHERE "verifiedAt" IS NULL;
UPDATE "Email" SET "verifiedAt" = NOW(), "updatedAt" = NOW() WHERE "verifiedAt" IS NULL;
