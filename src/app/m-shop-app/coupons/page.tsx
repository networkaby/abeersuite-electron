import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import PortalCouponList from "@/modules/external/portal/PortalCouponList";
import { loadPortalCoupons } from "@/modules/external/portal/portalCoupons";
import { requireAppCustomerProfile } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** My Coupons in the app — the same live offers as the portal. */
export default async function CustomerAppCouponsPage() {
    const { active } = await requireAppCustomerProfile(`${APP}/coupons`);
    const coupons = await loadPortalCoupons(active.accountId);
    return (
        <>
            <MobileHeader title="My coupons" back={`${APP}/account`} actions={<PortalProfileSwitch className="mr-1" />} />
            <div className="p-3">
                <PortalCouponList coupons={coupons} />
            </div>
        </>
    );
}
