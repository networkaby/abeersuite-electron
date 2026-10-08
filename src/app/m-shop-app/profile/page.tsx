import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalProfileView from "@/modules/external/portal/profile/PortalProfileView";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** My Profile — photo, details, profiles, contacts, password: the portal's own panels under the app's header. */
export default async function CustomerAppProfilePage() {
    await requireAppCustomer(`${APP}/profile`);
    return (
        <>
            <MobileHeader title="My profile" back={`${APP}/account`} />
            <PortalProfileView bare />
        </>
    );
}
