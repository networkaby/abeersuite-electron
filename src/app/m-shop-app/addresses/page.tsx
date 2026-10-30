import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalAddressesView from "@/modules/external/portal/PortalAddressesView";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** Addresses — the portal's address book under the app's header. */
export default async function CustomerAppAddressesPage() {
    await requireAppCustomer(`${APP}/addresses`);
    return (
        <>
            <MobileHeader title="Addresses" back={`${APP}/account`} />
            <PortalAddressesView bare />
        </>
    );
}
