import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Percent } from "lucide-react";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalCouponList from "@/modules/external/portal/PortalCouponList";
import { loadPortalCoupons } from "@/modules/external/portal/portalCoupons";
import { resolveActivePortalAccount } from "@/shared/lib/auth/portalActiveAccount";

/** My Coupons — the shop's live online offers this profile can use (portalCoupons.ts). */
export default async function PortalCouponsPage() {
    const session = await auth();
    const user = session?.user as { kind?: string; customerId?: string } | undefined;
    const customerId = Number.parseInt(user?.customerId ?? "", 10);
    if (user?.kind !== "customer" || !Number.isFinite(customerId)) redirect("/login?callbackUrl=/portal/coupons");
    const context = await resolveActivePortalAccount(customerId);
    if (!context) redirect("/portal");
    const coupons = await loadPortalCoupons(context.active.accountId);

    return (
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader title="My Coupons" description={`Offers you can use online, for ${context.active.label}.`} icon={Percent} />
                <PortalCouponList coupons={coupons} />
            </div>
        </main>
    );
}
