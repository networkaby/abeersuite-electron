// SERVER-ONLY (imports the prisma client). Resolves the single payment gateway
// that online checkout should use. Config-only this phase: the storefront READS
// this to show "Pay online via <name>"; the live charge + webhook stay parked.

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type ActiveOnlineGateway = {
    id: number;
    provider: string;
    displayName: string;
    environment: string;
};

/// The active online gateway = first enabled-for-online, active catalog entry
/// (the create/update API enforces at most one online-enabled per environment).
/// Returns null when none is configured (storefront falls back to COD-only).
export async function getActiveOnlineGateway(): Promise<ActiveOnlineGateway | null> {
    const row = await prisma.paymentGateway.findFirst({
        where: { enabledForOnline: true, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, provider: true, displayName: true, environment: true },
    });
    return row ?? null;
}
