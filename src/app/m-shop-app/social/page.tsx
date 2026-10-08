import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalSocialView from "@/modules/external/portal/social/PortalSocialView";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** Social — the portal's own Social area under the app's header: every feature, one copy. */
export default async function CustomerAppSocialPage() {
    await requireAppCustomer(`${APP}/social`);
    return (
        <>
            <MobileHeader title="Social" back={`${APP}/account`} />
            <PortalSocialView />
        </>
    );
}
