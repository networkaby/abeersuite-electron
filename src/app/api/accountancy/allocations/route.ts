import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { assertLinkable, createLink, BillLinkError } from "@/modules/accountancy/lib/billLink";

// A link is a statement about two POSTED vouchers, so it is gated at the same
// rung as editing one: `cancel` on BOTH kinds. Kinds with no matrix row (POS,
// online channel variants) pass through, exactly as everywhere else.
function canLink(user: Parameters<typeof userCanVoucher>[0], types: string[]): boolean {
    return types.every((t) => userCanVoucher(user, t, "cancel"));
}

const createSchema = z.object({
    /** The party ledger the link is measured on — links only exist against a party. */
    accountId: z.number().int().positive(),
    /** The voucher doing the linking (the one the user has open). */
    voucherId: z.number().int().positive(),
    /** The counterparts it settles, and how much of each. */
    links: z.array(z.object({
        voucherId: z.number().int().positive(),
        amount:    z.number().positive(),
    })).min(1).max(200),
    reference: z.string().trim().max(120).optional(),
});

// GET /api/accountancy/allocations?voucherId=42
// Every link this voucher takes part in, whichever side it sits on.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const voucherId = Number(searchParams.get("voucherId"));
    if (!Number.isFinite(voucherId) || voucherId <= 0) {
        return NextResponse.json({ error: "voucherId required" }, { status: 400 });
    }

    const links = await prisma.voucherAllocation.findMany({
        where: {
            targetType: "UNIVERSAL_VOUCHER",
            sourceType: { in: ["VOUCHER", "PAYMENT"] },
            OR:         [{ targetId: voucherId }, { sourceId: voucherId }],
        },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }],
    });

    // Name the other end, so the caller can show "settled against SV-26-27-0031"
    // without a second round trip.
    const otherIds = links.map((l) => (l.targetId === voucherId ? l.sourceId : l.targetId));
    const others = otherIds.length === 0 ? [] : await prisma.universalVoucher.findMany({
        where:  { id: { in: [...new Set(otherIds)] } },
        select: { id: true, type: true, voucherNo: true, date: true, status: true, cancelledAt: true, deletedAt: true },
    });
    const otherById = new Map(others.map((o) => [o.id, o]));

    return NextResponse.json(links.map((l) => {
        const otherId = l.targetId === voucherId ? l.sourceId : l.targetId;
        const other = otherById.get(otherId) ?? null;
        return {
            id:        l.id,
            amount:   Number(l.amount),
            reference: l.reference,
            createdAt: l.createdAt,
            createdBy: l.createdBy,
            other,
            // A link whose other end has gone is already ignored by every reader —
            // saying so lets the UI show it as spent rather than as settlement.
            live: other !== null && other.status === "POSTED" && other.deletedAt === null,
        };
    }));
}

// POST /api/accountancy/allocations
// Link one voucher to one or more counterparts, in a single transaction — either
// all the links land or none do, so a half-settled bill is impossible.
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;

    try {
        const ids = [data.voucherId, ...data.links.map((l) => l.voucherId)];
        const vouchers = await prisma.universalVoucher.findMany({
            where:  { id: { in: [...new Set(ids)] } },
            select: { id: true, type: true },
        });
        if (vouchers.length !== new Set(ids).size) {
            return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        }
        if (!canLink(user, [...new Set(vouchers.map((v) => v.type))])) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const created = await prisma.$transaction(async (tx) => {
            const out: number[] = [];
            for (const link of data.links) {
                // Checked one at a time and inside the transaction, so each link
                // sees the room the previous ones already took.
                const { targetId, sourceId } = await assertLinkable(tx, {
                    accountId: data.accountId,
                    aId:       data.voucherId,
                    bId:       link.voucherId,
                    amount:    link.amount,
                });
                out.push(await createLink(tx, {
                    targetId, sourceId,
                    amount:    link.amount,
                    reference: data.reference ?? null,
                    userId:    user!.id,
                }));
            }
            return out;
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, ids: created }, { status: 201 });
    } catch (e) {
        // A refusal the user can act on ("bill has only ₹480 open"), not a fault.
        if (e instanceof BillLinkError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to link vouchers");
    }
}
