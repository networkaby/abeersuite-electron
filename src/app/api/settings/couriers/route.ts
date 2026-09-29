import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { DELIVERY_METHOD_DEFAULTS, sanitizeDeliveryConfig } from "@/modules/delivery/lib/deliveryMethods";

// Settings → Couriers. The six delivery options (Local delivery / Standard courier /
// Shiprocket / Shipway / Pickup from store / Free delivery) are HARD-CODED — not
// addable or deletable here. Only their editable config is stored in the DB. Any
// signed-in staff may read/edit — the Settings sidebar tick decides who reaches the
// page. Aggregator SECRETS stay in env.

/** Create any of the hard-coded couriers that don't yet exist (create-if-absent, by
 *  kind). Makes the catalog self-healing on a fresh DB — no seed required. */
async function ensureDeliveryMethodDefaults(): Promise<void> {
    const present = new Set((await prisma.deliveryMethod.findMany({ select: { kind: true } })).map((m) => m.kind));
    const missing = DELIVERY_METHOD_DEFAULTS.filter((d) => !present.has(d.kind));
    if (missing.length === 0) return;
    await prisma.deliveryMethod.createMany({
        data: missing.map((d) => ({
            kind: d.kind,
            displayName: d.displayName,
            isActive: d.isActive,
            sortOrder: d.sortOrder,
            configJson: sanitizeDeliveryConfig(d.kind, d.configJson) as Prisma.InputJsonValue,
        })),
    });
}

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        await ensureDeliveryMethodDefaults();
        const rows = await prisma.deliveryMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
        return NextResponse.json({ methods: rows });
    } catch (e) {
        return handleApiError(e, "Failed to load couriers");
    }
}

// No POST: the courier catalog is hard-coded (add another by extending
// DELIVERY_METHOD_DEFAULTS in code). Next answers 405 for the missing method.
