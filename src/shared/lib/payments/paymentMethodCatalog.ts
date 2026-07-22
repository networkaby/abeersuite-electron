// SERVER-ONLY (imports the prisma client). Self-heals the hard-coded payment-method
// catalog: ensures one PaymentGateway row per PAYMENT_METHOD_DEFAULTS entry
// (create-if-absent by provider), so the fixed set always exists without a seed
// (mirrors the courier catalog). Never overwrites an existing row — a method that's
// already configured (e.g. Razorpay) keeps its settings.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { PAYMENT_METHOD_DEFAULTS } from "@/modules/pos/lib/paymentGateways";

/// Create any missing catalog rows. Returns how many were created.
export async function ensurePaymentMethodCatalog(): Promise<number> {
    const present = new Set(
        (await prisma.paymentGateway.findMany({ select: { provider: true } })).map((r) => r.provider),
    );
    const missing = PAYMENT_METHOD_DEFAULTS.filter((d) => !present.has(d.provider));
    if (missing.length === 0) return 0;
    await prisma.paymentGateway.createMany({
        data: missing.map((d) => ({
            provider: d.provider,
            displayName: d.displayName,
            environment: d.environment,
            enabledForCounter: d.enabledForCounter,
            enabledForOnline: d.enabledForOnline,
            configJson: d.configJson as Prisma.InputJsonValue,
            sortOrder: d.sortOrder,
            isActive: d.isActive,
        })),
    });
    return missing.length;
}
