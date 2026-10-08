import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Wallet } from "lucide-react";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalWalletView from "@/modules/external/portal/PortalWalletView";
import { loadPortalWallet } from "@/modules/external/portal/portalWallet";
import { resolveActivePortalAccount } from "@/shared/lib/auth/portalActiveAccount";

/** My Wallet — reward points and gift cards of the profile in use (portalWallet.ts). */
export default async function PortalWalletPage() {
    const session = await auth();
    const user = session?.user as { kind?: string; customerId?: string } | undefined;
    const customerId = Number.parseInt(user?.customerId ?? "", 10);
    if (user?.kind !== "customer" || !Number.isFinite(customerId)) redirect("/login?callbackUrl=/portal/wallet");
    const context = await resolveActivePortalAccount(customerId);
    if (!context) redirect("/portal");
    const wallet = await loadPortalWallet(context.active.accountId);

    return (
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-3xl space-y-5">
                <PortalSectionHeader title="My Wallet" description="Reward points and gift cards." icon={Wallet} />
                <PortalWalletView wallet={wallet} profileLabel={context.active.label} />
            </div>
        </main>
    );
}
