import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { costPoolDrawCreateSchema } from "@/shared/lib/schemas/costPoolSchemas";
import { getEntryRemainingPaise } from "@/modules/pricing-strategy/lib/costPool";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// GET /api/pricing-strategy/costing/draws — draw history.
//   ?productId=N       → allocations for one product
//   ?sourceGlLineId=N  → draws against one pool entry (a spine VoucherGlLine)
//   ?invVoucherId=N    → all allocations spread from one purchase/GRN (its legs)
// Otherwise: the whole history (most recent first).
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const productId = Number(searchParams.get("productId")) || undefined;
        const sourceGlLineId = Number(searchParams.get("sourceGlLineId")) || undefined;
        const sourceInvVoucherId = Number(searchParams.get("invVoucherId")) || undefined;

        const rows = await prisma.additionalCostAllocation.findMany({
            where: {
                ...(productId ? { productId } : {}),
                ...(sourceGlLineId ? { sourceVoucherGlLineId: sourceGlLineId } : {}),
                ...(sourceInvVoucherId ? { sourceInvVoucherId } : {}),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 500,
            select: {
                id: true,
                kind: true,
                amountPaise: true,
                perUnitPaise: true,
                quantity: true,
                note: true,
                date: true,
                createdAt: true,
                productId: true,
                product: { select: { name: true, sku: true } },
                sourceVoucherGlLineId: true,
                // Originating document number / type + orphan status come straight
                // off the spine header — no JE→voucher lookup needed (G2). The spine
                // line is scalar/id-only, so the ledger name is resolved separately.
                sourceVoucherGlLine: {
                    select: {
                        accountId: true,
                        universalVoucher: { select: { friendlyRef: true, type: true, status: true, deletedAt: true } },
                    },
                },
                sourceInvVoucherId: true,
                sourceInvVoucher: { select: { reference: true, type: true, partyJson: true } },
                createdBy: { select: { name: true } },
            },
        });

        // Ledger names for the source debits (VoucherGlLine has no `account`
        // relation until G4) — one batched lookup keyed by accountId.
        const acctIds = [...new Set(rows.map((r) => r.sourceVoucherGlLine?.accountId).filter((x): x is number => x != null))];
        const acctNameById = new Map(
            (acctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, name: true } }))
                .map((a) => [a.id, a.name]),
        );

        const draws = rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            amountPaise: r.amountPaise,
            perUnitPaise: r.perUnitPaise,
            quantity: r.quantity != null ? Number(r.quantity) : null,
            note: r.note,
            date: r.date.toISOString(),
            createdAt: r.createdAt.toISOString(),
            productId: r.productId,
            productName: r.product?.name ?? null,
            productSku: r.product?.sku ?? null,
            sourceGlLineId: r.sourceVoucherGlLineId,
            ledgerName: r.sourceVoucherGlLine?.accountId != null ? (acctNameById.get(r.sourceVoucherGlLine.accountId) ?? null) : null,
            reference: r.sourceVoucherGlLine?.universalVoucher?.friendlyRef ?? null,
            referenceType: r.sourceVoucherGlLine?.universalVoucher?.type ?? null,
            invVoucherId: r.sourceInvVoucherId,
            invVoucherRef: r.sourceInvVoucher?.reference ?? null,
            invVoucherType: r.sourceInvVoucher?.type ?? null,
            invVoucherParty: readPartyName(r.sourceInvVoucher?.partyJson),
            createdByName: r.createdBy?.name ?? null,
            // The source entry was cancelled/deleted after this draw was made.
            orphaned:
                r.sourceVoucherGlLine?.universalVoucher?.status !== "POSTED" ||
                r.sourceVoucherGlLine?.universalVoucher?.deletedAt != null,
        }));

        return NextResponse.json(draws);
    } catch (e) {
        return handleApiError(e, "Failed to load draws");
    }
}

// POST /api/pricing-strategy/costing/draws — record an ALLOCATION or DISMISSAL
// draw against a posted pool debit. NEVER posts to the GL.
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, costPoolDrawCreateSchema);
        if (error) return error;

        // The source debit must still be a live pool-eligible posted debit, and
        // the draw must fit within its remaining un-drawn amount.
        const remaining = await getEntryRemainingPaise(data.sourceGlLineId);
        if (remaining == null) {
            return NextResponse.json(
                { error: "Source entry is not a posted debit (or was cancelled)." },
                { status: 400 },
            );
        }
        if (data.amountPaise > remaining) {
            return NextResponse.json(
                { error: `Amount exceeds the entry's remaining ₹${(remaining / 100).toFixed(2)}.` },
                { status: 400 },
            );
        }

        const date = data.date ? new Date(data.date) : new Date();
        const draw = await prisma.additionalCostAllocation.create({
            data: {
                kind: data.kind,
                sourceVoucherGlLineId: data.sourceGlLineId,
                amountPaise: data.amountPaise,
                note: data.note ?? null,
                date,
                createdById: user.id,
                ...(data.kind === "ALLOCATION"
                    ? {
                          productId: data.productId,
                          perUnitPaise: data.perUnitPaise,
                          quantity: data.quantity ?? null,
                      }
                    : {}),
            },
            select: { id: true },
        });

        return NextResponse.json({
            id: draw.id,
            remainingPaise: remaining - data.amountPaise,
        });
    } catch (e) {
        return handleApiError(e, "Failed to record draw");
    }
}
