import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileOutstanding from "@/modules/mobile/components/MobileOutstanding";

export default async function MobileReceivablesPage() {
    const user = await mobileUser(PERMISSIONS.MOBILE_RECEIVABLES_VIEW);
    return <MobileOutstanding side="receivables" userId={user.id} />;
}
