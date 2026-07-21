// SERVER-ONLY. Loads the courier options the storefront offers at checkout.
// One DeliveryMethod row per courier (shop.prisma) — same config-only shape as
// PaymentGateway. The customer picks one at checkout; its rate becomes the bill's
// shipping charge and the chosen kind rides onto the Delivery ticket's carrier.
//
// The pure vocabulary + config helpers (kinds, labels, types, sanitizer) live in
// deliveryMethodConfig.ts (client-safe) and are re-exported here so existing
// server-side imports keep working from one place.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { type DeliveryKind, type DeliveryMethodRow } from "./deliveryMethodConfig";

export * from "./deliveryMethodConfig";

function asRow(r: {
    id: number;
    kind: string;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: unknown;
}): DeliveryMethodRow {
    return {
        id: r.id,
        kind: r.kind as DeliveryKind,
        displayName: r.displayName,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
        configJson: (r.configJson && typeof r.configJson === "object" ? r.configJson : {}) as Record<string, unknown>,
    };
}

/** All active courier methods, cheapest-sortOrder first. */
export async function loadActiveDeliveryMethods(): Promise<DeliveryMethodRow[]> {
    const rows = await prisma.deliveryMethod.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
    });
    return rows.map(asRow);
}

/** The single active method of a kind (config source for the Shiprocket client etc). */
export async function loadDeliveryMethod(kind: DeliveryKind): Promise<DeliveryMethodRow | null> {
    const row = await prisma.deliveryMethod.findFirst({
        where: { kind, isActive: true },
        orderBy: { sortOrder: "asc" },
    });
    return row ? asRow(row) : null;
}
