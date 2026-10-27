import { redirect } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import PortalWalletView from "@/modules/external/portal/PortalWalletView";
import { loadPortalWallet } from "@/modules/external/portal/portalWallet";
import { requireAppCustomerProfile } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { SHOP_APP_HIDE_REWARDS } from "@/shared/lib/device/shopApp";

/** My Wallet in the app — reward points and gift cards, the same as the portal. */
export default async function CustomerAppWalletPage() {
    if (SHOP_APP_HIDE_REWARDS) redirect(`${APP}/account`);
    const { active } = await requireAppCustomerProfile(`${APP}/wallet`);
    const wallet = await loadPortalWallet(active.accountId);
    return (
        <>
            <MobileHeader title="My wallet" back={`${APP}/account`} actions={<PortalProfileSwitch className="mr-1" />} />
            <div className="p-3">
                <PortalWalletView wallet={wallet} profileLabel={active.label} />
            </div>
        </>
    );
}
