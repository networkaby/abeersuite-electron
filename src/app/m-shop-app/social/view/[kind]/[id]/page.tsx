import { redirect } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalSocialProfileView from "@/modules/external/portal/social/PortalSocialProfileView";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { SHOP_APP_PLAY_REVIEW } from "@/shared/lib/device/shopApp";

/** Someone's social profile, under the app's header — the portal's own view. */
export default async function CustomerAppSocialProfilePage({ params }: { params: Promise<{ kind: string; id: string }> }) {
    if (SHOP_APP_PLAY_REVIEW) redirect(`${APP}/account`);
    const { kind, id } = await params;
    await requireAppCustomer(`${APP}/social/view/${kind}/${id}`);
    return (
        <>
            <MobileHeader title="Profile" back={`${APP}/social`} />
            <PortalSocialProfileView />
        </>
    );
}
