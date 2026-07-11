import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { giftCardUpdateSchema } from "@/shared/lib/schemas/giftCardSchemas";

// PATCH /api/gift-cards/[id] — edit a DRAFT card (value / code / owner / expiry).
// Once issued (ACTIVE) the card is backed by a real liability and is immutable here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.GIFT_CARDS_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, giftCardUpdateSchema);
    if (error) return error;

    try {
        const card = await prisma.giftCard.findUnique({ where: { id }, select: { status: true } });
        if (!card) return NextResponse.json({ error: "Gift card not found" }, { status: 404 });

        const { enabled, ...content } = data;
        const editsContent = content.code !== undefined || content.initialValue !== undefined || content.ownerAccountId !== undefined || content.expiresAt !== undefined;

        // Content edits (value/code/owner/expiry) are DRAFT-only.
        if (editsContent && card.status !== "DRAFT") {
            return NextResponse.json({ error: "Only draft (unsold) gift cards can be edited", code: "GC_NOT_DRAFT" }, { status: 409 });
        }
        // The enable/disable toggle (no GL) only makes sense for DRAFT + ACTIVE cards.
        if (enabled !== undefined && card.status !== "DRAFT" && card.status !== "ACTIVE") {
            return NextResponse.json({ error: `A ${card.status.toLowerCase()} gift card can't be enabled/disabled`, code: "GC_TERMINAL" }, { status: 409 });
        }

        if (content.code) {
            const clash = await prisma.giftCard.findFirst({ where: { code: content.code.trim(), id: { not: id } }, select: { id: true } });
            if (clash) return NextResponse.json({ error: "Gift-card code already exists", code: "GC_DUP" }, { status: 422 });
        }

        const updated = await prisma.giftCard.update({
            where: { id },
            data: {
                ...(content.code !== undefined ? { code: content.code.trim() } : {}),
                ...(content.initialValue !== undefined ? { initialValue: content.initialValue, balance: content.initialValue } : {}),
                ...(content.ownerAccountId !== undefined ? { ownerAccountId: content.ownerAccountId } : {}),
                ...(content.expiresAt !== undefined ? { expiresAt: content.expiresAt } : {}),
                ...(enabled !== undefined ? { enabled } : {}),
            },
            include: { ownerAccount: { select: { name: true } } },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update gift card");
    }
}

// DELETE /api/gift-cards/[id] — hard-delete a DRAFT card (nothing posted to the
// GL). Issued/redeemed/expired cards carry real accounting and cannot be deleted.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.GIFT_CARDS_DELETE);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    try {
        const card = await prisma.giftCard.findUnique({ where: { id }, select: { status: true } });
        if (!card) return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
        if (card.status !== "DRAFT") {
            return NextResponse.json(
                { error: "Only draft (unsold) gift cards can be deleted. Issued cards carry a liability — let them be redeemed or expire.", code: "GC_NOT_DRAFT" },
                { status: 409 },
            );
        }
        await prisma.giftCard.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete gift card");
    }
}
