// SERVER-ONLY (imports the prisma client). Resolves the payment gateways online
// checkout may use. Multiple gateways can be enabled for online at once — the
// storefront offers each as its own pay option. A gateway is OFFERED only when it
// is active + enabled-for-online + its charge flow is wired + a settlement ledger
// is configured (no ledger → unusable, so every online payment is bookable to GL).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { settlementAccountIdOf } from "@/modules/pos/lib/paymentGateways";

export type ActiveOnlineGateway = {
    id: number;
    provider: string;
    displayName: string;
    environment: string;
    /** GL ledger this gateway's collections settle into (configJson). */
    settlementAccountId: number | null;
};

/// Providers with a working storefront charge flow today. A gateway can be enabled
/// for online in Settings, but it's only OFFERED at checkout once it's in this set
/// (so enabling e.g. a future gateway early never dead-ends the customer).
export const ONLINE_PAYABLE_PROVIDERS: ReadonlySet<string> = new Set([
    "demo",
    "payu",
    "razorpay",
    "cashfree",
]);

/// All gateways enabled for online (active), in display order.
export async function getActiveOnlineGateways(): Promise<ActiveOnlineGateway[]> {
    const rows = await prisma.paymentGateway.findMany({
        where: { enabledForOnline: true, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, provider: true, displayName: true, environment: true, configJson: true },
    });
    return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        displayName: r.displayName,
        environment: r.environment,
        settlementAccountId: settlementAccountIdOf(r.configJson),
    }));
}

/// The enabled-online gateways the storefront should actually OFFER: charge flow
/// wired AND a settlement ledger configured (else the gateway is unusable).
export async function getPayableOnlineGateways(): Promise<ActiveOnlineGateway[]> {
    const all = await getActiveOnlineGateways();
    return all.filter(
        (g) => ONLINE_PAYABLE_PROVIDERS.has(g.provider) && g.settlementAccountId != null,
    );
}

/// Per-provider guard for the charge routes: the gateway row when `provider` is
/// currently offerable (enabled + wired + ledger set), else null.
export async function getPayableGateway(provider: string): Promise<ActiveOnlineGateway | null> {
    const all = await getPayableOnlineGateways();
    return all.find((g) => g.provider === provider) ?? null;
}

/// First enabled-online gateway (back-compat for single-gateway callers).
export async function getActiveOnlineGateway(): Promise<ActiveOnlineGateway | null> {
    const [first] = await getActiveOnlineGateways();
    return first ?? null;
}
