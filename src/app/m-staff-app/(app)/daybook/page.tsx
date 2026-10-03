import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileDayBook from "@/modules/mobile/components/MobileDayBook";

export default async function MobileDayBookPage() {
    const user = await mobileUser(PERMISSIONS.MOBILE_DAYBOOK_VIEW);
    return <MobileDayBook userId={user.id} />;
}
