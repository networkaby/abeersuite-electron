import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileParties from "@/modules/mobile/components/MobileParties";

export default async function MobilePartiesPage() {
    await mobileUser(PERMISSIONS.MOBILE_PARTIES_VIEW);
    return <MobileParties />;
}
