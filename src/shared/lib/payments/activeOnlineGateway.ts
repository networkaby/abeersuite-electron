// SERVER-ONLY (imports the prisma client). Resolves the payment gateways online
// checkout may use. Multiple gateways can be enabled for online at once — the
// storefront offers each as its own pay option. Config-only where the charge isn't
// wired yet; only providers in ONLINE_PAYABLE_PROVIDERS have a working pay flow.

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type ActiveOnlineGateway = {
    id: number;
    provider: string;
    displayName: string;
    environment: string;
};

/// Providers with a working storefront charge flow today. A gateway can be enabled
/// for online in Settings, but it's only OFFERED at checkout once it's in this set
/// (so enabling e.g. Razorpay early never dead-ends the customer).
export const ONLINE_PAYABLE_PROVIDERS: ReadonlySet<string> = new Set([
    "demo",
    "payu",
    "razorpay",
    "cashfree",
]);

/// All gateways enabled for online (active), in display order.
export async function getActiveOnlineGateways(): Promise<ActiveOnlineGateway[]> {
    return prisma.paymentGateway.findMany({
        where: { enabledForOnline: true, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, provider: true, displayName: true, environment: true },
    });
}

/// The enabled-online gateways that actually have a working pay flow — what the
/// storefront should render as pay options.
export async function getPayableOnlineGateways(): Promise<ActiveOnlineGateway[]> {
    const all = await getActiveOnlineGateways();
    return all.filter((g) => ONLINE_PAYABLE_PROVIDERS.has(g.provider));
}

/// True when `provider` is currently enabled for online (active). Used by the
/// per-gateway charge routes to authorise a payment attempt.
export async function isOnlineGatewayEnabled(provider: string): Promise<boolean> {
    const row = await prisma.paymentGateway.findFirst({
        where: { provider, enabledForOnline: true, isActive: true },
        select: { id: true },
    });
    return !!row;
}

/// First enabled-online gateway (back-compat for single-gateway callers).
export async function getActiveOnlineGateway(): Promise<ActiveOnlineGateway | null> {
    const [first] = await getActiveOnlineGateways();
    return first ?? null;
}
