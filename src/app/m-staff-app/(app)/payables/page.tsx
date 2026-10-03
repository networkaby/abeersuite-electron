import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileOutstanding from "@/modules/mobile/components/MobileOutstanding";

export default async function MobilePayablesPage() {
    const user = await mobileUser(PERMISSIONS.MOBILE_PAYABLES_VIEW);
    return <MobileOutstanding side="payables" userId={user.id} />;
}
