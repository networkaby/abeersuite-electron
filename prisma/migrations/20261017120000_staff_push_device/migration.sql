-- Staff phone app push (2026-10-17): a customer's WhatsApp message notifies
-- staff phones even with the app closed (FCM, push/staffPush.ts).
--
-- RELEASE GATE: the table syncs to the counters (child of User), so every till
-- must run the build that carries it BEFORE the d_office push applies this
-- migration (AGENTS.md §3). No data to carry.

-- CreateTable
CREATE TABLE "StaffPushDevice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPushDevice_token_key" ON "StaffPushDevice"("token");

-- CreateIndex
CREATE INDEX "StaffPushDevice_userId_idx" ON "StaffPushDevice"("userId");

-- AddForeignKey
ALTER TABLE "StaffPushDevice" ADD CONSTRAINT "StaffPushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sync-touch: StaffPushDevice -> User (gen-sync-registry.ts --touch-sql)
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "StaffPushDevice";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "StaffPushDevice"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');
