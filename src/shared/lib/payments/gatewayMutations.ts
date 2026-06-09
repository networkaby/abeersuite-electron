// SERVER-ONLY shared write helpers for the payment-gateway catalog. Kept out of the
// route files so both POST (route.ts) and PATCH ([id]/route.ts) reuse the same
// single-winner rule without a route importing another route.

import type { Prisma } from "@/generated/prisma/client";

type GatewayTxClient = { paymentGateway: Prisma.PaymentGatewayDelegate };

/// Enforce ≤1 active online gateway per environment: turning on online for `keepId`
/// clears the flag on every other entry in the same environment. Run inside a tx.
export async function clearOnlineSiblings(
    tx: GatewayTxClient,
    environment: string,
    keepId: number | null,
): Promise<void> {
    await tx.paymentGateway.updateMany({
        where: {
            environment,
            enabledForOnline: true,
            ...(keepId !== null ? { id: { not: keepId } } : {}),
        },
        data: { enabledForOnline: false },
    });
}
