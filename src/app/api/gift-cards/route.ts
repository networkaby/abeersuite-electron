import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { giftCardGenerateSchema } from "@/shared/lib/schemas/giftCardSchemas";
import { randomUUID } from "crypto";

// GET /api/gift-cards — list gift cards with balances. Any authed user (POS lookup
// reads via /api/pos/gift-card-lookup); generating/issuing requires coupons:manage.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const cards = await prisma.giftCard.findMany({
            orderBy: { createdAt: "desc" },
            include: { ownerAccount: { select: { name: true } } },
        });
        return NextResponse.json(cards);
    } catch (e) {
        return handleApiError(e, "Failed to fetch gift cards");
    }
}

// POST /api/gift-cards — GENERATE a gift card. Creates a DRAFT card only: no GL
// posting, no money taken. It can be shared, printed, edited and deleted freely
// until it is sold via POST /api/gift-cards/[id]/issue (which posts the liability).
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.COUPONS_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, giftCardGenerateSchema);
    if (error) return error;

    try {
        const code = (data.code?.trim() || `GC-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
        const existing = await prisma.giftCard.findUnique({ where: { code } });
        if (existing) return NextResponse.json({ error: "Gift-card code already exists", code: "GC_DUP" }, { status: 422 });

        const card = await prisma.giftCard.create({
            data: {
                code,
                initialValue:   data.initialValue,
                balance:        data.initialValue,
                status:         "DRAFT",
                ownerAccountId: data.ownerAccountId ?? null,
                expiresAt:      data.expiresAt ?? null,
                createdById:    user!.id,
            },
            include: { ownerAccount: { select: { name: true } } },
        });
        return NextResponse.json(card, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to generate gift card");
    }
}
