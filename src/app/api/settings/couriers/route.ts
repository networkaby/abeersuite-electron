import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { DELIVERY_KINDS, sanitizeDeliveryConfig, type DeliveryKind } from "@/modules/delivery/lib/deliveryMethods";

// Settings → Couriers. The catalog of delivery methods offered at checkout
// (Shiprocket / Custom courier / Local delivery boy). Any signed-in staff may read
// and write — the Settings sidebar tick decides who reaches the page. Shiprocket
// SECRETS stay in env; only non-secret config (pickup, weight, dims) lives here.

const createSchema = z.object({
    kind: z.string().refine((k) => DELIVERY_KINDS.includes(k as DeliveryKind), "Unknown courier kind"),
    displayName: z.string().trim().min(1, "Display name is required").max(80),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    configJson: z.record(z.string(), z.unknown()).default({}),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.deliveryMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
        return NextResponse.json({ methods: rows });
    } catch (e) {
        return handleApiError(e, "Failed to load couriers");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    try {
        const kind = data.kind as DeliveryKind;
        const created = await prisma.deliveryMethod.create({
            data: {
                kind,
                displayName: data.displayName,
                isActive: data.isActive,
                sortOrder: data.sortOrder,
                configJson: sanitizeDeliveryConfig(kind, data.configJson) as Prisma.InputJsonValue,
            },
        });
        return NextResponse.json({ method: created }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create courier");
    }
}
