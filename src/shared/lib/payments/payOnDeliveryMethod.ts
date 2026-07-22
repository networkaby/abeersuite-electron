// SERVER-ONLY (imports the prisma client). Resolves the single Pay-on-Delivery
// rail and self-heals it: the app ensures exactly one PaymentGateway row with
// provider "pay_on_delivery" exists, so no seed is required (mirrors the hard-coded
// courier catalog). The row stores only editable config — Active + the area rule.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    PAY_ON_DELIVERY_PROVIDER_ID,
    PAYMENT_METHOD_DEFAULTS,
} from "@/modules/pos/lib/paymentGateways";
import { isPayOnDeliveryAvailableForArea } from "./payOnDelivery";
import type { Prisma } from "@/generated/prisma/client";

// Single source: the POD entry in the hard-coded catalog.
const POD_DEFAULT = PAYMENT_METHOD_DEFAULTS.find((d) => d.provider === PAY_ON_DELIVERY_PROVIDER_ID)!;

/// Create-if-absent the single POD row. Default: Active (preserves the old
/// always-on Cash-on-Delivery behaviour), no area restriction. Returns the row.
/// The shop paths self-heal only POD (a public storefront hit shouldn't spawn the
/// gateway rows) — the admin Payment Methods page ensures the whole catalog.
export async function ensurePayOnDeliveryMethod() {
    const existing = await prisma.paymentGateway.findFirst({
        where: { provider: PAY_ON_DELIVERY_PROVIDER_ID },
    });
    if (existing) return existing;
    return prisma.paymentGateway.create({
        data: {
            provider: POD_DEFAULT.provider,
            displayName: POD_DEFAULT.displayName,
            environment: POD_DEFAULT.environment,
            enabledForCounter: POD_DEFAULT.enabledForCounter,
            enabledForOnline: POD_DEFAULT.enabledForOnline,
            configJson: POD_DEFAULT.configJson as Prisma.InputJsonValue,
            sortOrder: POD_DEFAULT.sortOrder,
            isActive: POD_DEFAULT.isActive,
        },
    });
}

export type PayOnDeliveryOffer = {
    active: boolean;
    displayName: string;
    /** active AND (no address given, or the address passes the area rule). */
    availableHere: boolean;
};

/// Resolve POD for a checkout address. With no pincode, `availableHere` reflects
/// only the active-state (optimistic — the area is checked once an address exists).
export async function resolvePayOnDelivery(
    pincode?: string,
    state?: string | null,
): Promise<PayOnDeliveryOffer> {
    const row = await ensurePayOnDeliveryMethod();
    const active = row.isActive;
    const area = (row.configJson as { area?: unknown } | null)?.area;
    const availableHere =
        active && (pincode ? isPayOnDeliveryAvailableForArea(area, pincode, state) : true);
    return { active, displayName: row.displayName, availableHere };
}
