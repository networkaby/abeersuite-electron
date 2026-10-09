import { INBOX_PERMISSIONS, mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileInbox from "@/modules/mobile/components/MobileInbox";

export default async function MobileInboxPage() {
    await mobileUser(INBOX_PERMISSIONS);
    return <MobileInbox />;
}

