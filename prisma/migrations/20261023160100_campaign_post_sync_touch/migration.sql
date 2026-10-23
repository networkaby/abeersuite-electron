-- CampaignPost is a child of Campaign: a new or removed post line must bump the
-- campaign's updatedAt, or the edit never reaches a counter replica
-- (scripts/gen-sync-registry.ts --touch-sql; see 20261012230000_sync_touch_parent).
-- Its own file because 20261023160000_campaign_status_posts was already applied
-- to the local copy when the sync check asked for it.

-- sync-touch: CampaignPost -> Campaign
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "CampaignPost";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "CampaignPost"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('campaignId', 'Campaign', 'id', 'updatedAt');
