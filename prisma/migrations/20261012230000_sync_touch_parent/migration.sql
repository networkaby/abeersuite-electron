-- Child tables move their parent, so the desktop app's replica sees the edit.
--
-- The counter worker re-pulls a `child` set only when its parent's watermark
-- moves. A save that writes the child alone (an office attendance mark, a payroll
-- line, a ticket participant) left the parent still, and the replica kept the old
-- rows for good: the web showed the change, the app never did.
--
-- Server only. A replica is built from resources/local-schema.sql (the schema,
-- not these migrations), so the worker's own child replaces never fire this.
-- `scripts/gen-sync-registry.ts --check` fails when a child table lacks a trigger;
-- `--touch-sql` prints the block below.
--
-- p_col empty = the parent is itself a child: a no-op write fires ITS trigger and
-- walks up to the first watermark ancestor. GREATEST keeps a watermark from ever
-- moving backwards past a later app-side @updatedAt; timestamps are UTC, naive.

CREATE OR REPLACE FUNCTION sync_touch_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    fk     text := TG_ARGV[0];
    p_tab  text := TG_ARGV[1];
    p_pk   text := TG_ARGV[2];
    p_col  text := TG_ARGV[3];
    stmt   text;
BEGIN
    IF p_col = '' THEN
        stmt := format('UPDATE %I SET %I = %I WHERE %I = ($1).%I', p_tab, p_pk, p_pk, p_pk, fk);
    ELSE
        stmt := format('UPDATE %I SET %I = GREATEST(%I, (clock_timestamp() AT TIME ZONE ''UTC'')::timestamp(3)) WHERE %I = ($1).%I',
                       p_tab, p_col, p_col, p_pk, fk);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        EXECUTE stmt USING NEW;
    END IF;
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> fk) IS DISTINCT FROM (to_jsonb(NEW) ->> fk) THEN
        EXECUTE stmt USING OLD;
    END IF;
    RETURN NULL;
END $$;

-- sync-touch: AccountAlias -> Account
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "AccountAlias";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "AccountAlias"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('accountId', 'Account', 'id', 'updatedAt');

-- sync-touch: attendance_days -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "attendance_days";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "attendance_days"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');

-- sync-touch: attendance_spans -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "attendance_spans";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "attendance_spans"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');

-- sync-touch: ChatMessage -> ChatRoom
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "ChatMessage";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "ChatMessage"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('roomId', 'ChatRoom', 'id', 'updatedAt');

-- sync-touch: CouponProductRule -> Coupon
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "CouponProductRule";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "CouponProductRule"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('couponId', 'Coupon', 'id', 'updatedAt');

-- sync-touch: CustomerSocialProfile -> Person
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "CustomerSocialProfile";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "CustomerSocialProfile"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('personId', 'Person', 'id', 'updatedAt');

-- sync-touch: GiftCardTxn -> GiftCard
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "GiftCardTxn";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "GiftCardTxn"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('giftCardId', 'GiftCard', 'id', 'updatedAt');

-- sync-touch: inv_product_codes -> InvProduct
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "inv_product_codes";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "inv_product_codes"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('productId', 'InvProduct', 'id', 'updatedAt');

-- sync-touch: InvBomLine -> InvBom
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "InvBomLine";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "InvBomLine"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('bomId', 'InvBom', 'id', 'updatedAt');

-- sync-touch: InvStockLedger -> UniversalVoucher
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "InvStockLedger";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "InvStockLedger"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('universalVoucherId', 'UniversalVoucher', 'id', 'updatedAt');

-- sync-touch: leave_requests -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "leave_requests";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "leave_requests"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');

-- sync-touch: LoyaltyLedger -> LoyaltyAccount
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "LoyaltyLedger";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "LoyaltyLedger"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('accountId', 'LoyaltyAccount', 'id', 'updatedAt');

-- sync-touch: LoyaltyLot -> LoyaltyAccount
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "LoyaltyLot";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "LoyaltyLot"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('accountId', 'LoyaltyAccount', 'id', 'updatedAt');

-- sync-touch: payroll_run_lines -> payroll_runs
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "payroll_run_lines";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "payroll_run_lines"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('runId', 'payroll_runs', 'id', 'updatedAt');

-- sync-touch: PersonPortalCredential -> Person
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "PersonPortalCredential";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "PersonPortalCredential"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('personId', 'Person', 'id', 'updatedAt');

-- sync-touch: pos_cash_drops -> pos_shifts
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "pos_cash_drops";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "pos_cash_drops"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('shiftId', 'pos_shifts', 'id', 'updatedAt');

-- sync-touch: product_protection -> InvProduct
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "product_protection";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "product_protection"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('productId', 'InvProduct', 'id', 'updatedAt');

-- sync-touch: PushMessage -> Person
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "PushMessage";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "PushMessage"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('personId', 'Person', 'id', 'updatedAt');

-- sync-touch: PushSubscription -> Person
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "PushSubscription";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "PushSubscription"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('personId', 'Person', 'id', 'updatedAt');

-- sync-touch: QuickNote -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "QuickNote";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "QuickNote"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');

-- sync-touch: SavedFilter -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "SavedFilter";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "SavedFilter"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ownerUserId', 'User', 'id', 'updatedAt');

-- sync-touch: staff_salaries -> staff_profiles
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "staff_salaries";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "staff_salaries"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'staff_profiles', 'userId', 'updatedAt');

-- sync-touch: stock_reservations -> InvProduct
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "stock_reservations";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "stock_reservations"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('productId', 'InvProduct', 'id', 'updatedAt');

-- sync-touch: TicketDeal -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketDeal";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketDeal"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketDelivery -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketDelivery";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketDelivery"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketHelp -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketHelp";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketHelp"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketOrder -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketOrder";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketOrder"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketOrderLine -> TicketOrder
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketOrderLine";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketOrderLine"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('orderTicketId', 'TicketOrder', 'ticketId', '');

-- sync-touch: TicketParticipant -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketParticipant";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketParticipant"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketRefund -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketRefund";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketRefund"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: TicketRepair -> Ticket
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "TicketRepair";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "TicketRepair"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('ticketId', 'Ticket', 'id', 'updatedAt');

-- sync-touch: UserSurfaceSeen -> User
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "UserSurfaceSeen";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "UserSurfaceSeen"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('userId', 'User', 'id', 'updatedAt');

-- sync-touch: VoucherGlLine -> UniversalVoucher
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "VoucherGlLine";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "VoucherGlLine"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('universalVoucherId', 'UniversalVoucher', 'id', 'updatedAt');

-- sync-touch: VoucherInventoryLine -> UniversalVoucher
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "VoucherInventoryLine";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "VoucherInventoryLine"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('universalVoucherId', 'UniversalVoucher', 'id', 'updatedAt');

-- sync-touch: VoucherLink -> UniversalVoucher
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "VoucherLink";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "VoucherLink"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('universalVoucherId', 'UniversalVoucher', 'id', 'updatedAt');

-- One-time: staff whose attendance was marked recently, so marks already saved
-- on the server reach every till on the next cycle instead of waiting for a touch.
UPDATE "User" SET "updatedAt" = GREATEST("updatedAt", (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3))
WHERE id IN (SELECT DISTINCT "userId" FROM "attendance_days" WHERE "updatedAt" > now() - interval '60 days');
