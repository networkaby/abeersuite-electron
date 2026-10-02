import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/mobileAccess";
import MobileParties from "@/modules/mobile/MobileParties";

export default async function MobilePartiesPage() {
    const user = await mobileUser(PERMISSIONS.MOBILE_PARTIES_VIEW);
    return <MobileParties userId={user.id} />;
}
