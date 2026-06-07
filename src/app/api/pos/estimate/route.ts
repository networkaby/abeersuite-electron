import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { getDealsPipeline, findOpenDealForParty } from "@/modules/deals/lib/dealsPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

/**
 * POST /api/pos/estimate — O2C Phase 1 (POS Estimate mode).
 *
 * Creates an ESTIMATE InvVoucher (price-privacy quotation — lines priced at the
 * barcode/tag price, no stock, no GL) and, when a party is attached, captures a
 * CRM Deal (find-or-create the party's open deal; stamp a SYSTEM activity; soft-
 * link voucher.dealId). Anonymous estimates save the quote only — no deal.
 *
 * Gated by the same permission as the POS sale, so a cashier needs no
 * `deals:manage` — the deal is created server-side under this gate.
 */
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const session = await auth();
    const body = await req.json();
    const {
        date,
        notes,
        accountId,
        partyName,
        partyType,   // "customer" | "company"
        partyId,     // Person.id (customer) or Company.id (company)
        partyPhone,
        lines = [],
    } = body as {
        date?: string;
        notes?: string;
        accountId?: number | null;
        partyName?: string | null;
        partyType?: string | null;
        partyId?: number | null;
        partyPhone?: string | null;
        lines: {
            productId: number;
            description?: string;
            quantity: number;
            rate: number;        // tag/cap price in rupees
            mrpPaise?: number;
            taxRate?: number;
        }[];
    };

    if (!Array.isArray(lines) || lines.length === 0) {
        return NextResponse.json({ error: "At least one line item required" }, { status: 400 });
    }
    for (const l of lines) {
        if (!l.productId || !(l.quantity > 0)) {
            return NextResponse.json({ error: "Each line needs a product and quantity > 0" }, { status: 400 });
        }
    }

    let branchId: string;
    try {
        branchId = resolveActiveBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.code === "forbidden_branch" ? 403 : 400 });
        }
        throw e;
    }

    // Tag price is the line rate; estimate carries no GL so we keep taxRate as
    // supplied (defaults to 0 → the printed quote shows the tag price as-is).
    const computedLines = lines.map((l) => {
        const rate = Number(l.rate) || 0;
        const { discountAmt, taxAmount, amount } = calcLineTotals({
            quantity: l.quantity,
            rate,
            discountPct: 0,
            discountAmt: 0,
            taxRate: l.taxRate ?? 0,
        });
        return { ...l, rate, discountAmt, taxAmount, amount };
    });
    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(computedLines, 0, 0, 0, 0);

    // Party shape — partyType maps to the linked CRM record for the deal.
    const personId = partyType === "customer" && partyId ? partyId : null;
    const companyId = partyType === "company" && partyId ? partyId : null;
    const hasParty = personId != null || companyId != null;

    // Resolve the Deals pipeline + entry stage outside the tx (plain reads).
    const pipeline = hasParty ? await getDealsPipeline(prisma) : null;
    if (hasParty && !pipeline) {
        return NextResponse.json({ error: "Deals pipeline not configured" }, { status: 503 });
    }
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0] ?? null;
    const actor = hasParty ? await buildActorSnapshot(user!.id) : null;

    const description = `POS Estimate${partyName ? ` — ${partyName}` : ""}`;
    const firstName = lines[0]?.description?.trim();

    try {
        const result = await prisma.$transaction(async (tx) => {
            const reference = await invNextRef(tx, "ESTIMATE", user!.id);
            const voucher = await tx.invVoucher.create({
                data: {
                    type: "ESTIMATE",
                    reference,
                    branchId,
                    date: date ? new Date(date) : new Date(),
                    description,
                    accountId: accountId ?? null,
                    partyName: partyName || null,
                    partyType: partyType || null,
                    partyId: partyId || null,
                    partyPhone: partyPhone || null,
                    deliveryMode: "COUNTER",
                    subtotal,
                    taxAmount,
                    totalAmount,
                    createdById: user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            productId: l.productId,
                            description: l.description || null,
                            quantity: l.quantity,
                            rate: l.rate,
                            mrpPaise: l.mrpPaise ?? null,
                            discountPct: 0,
                            discountAmt: l.discountAmt,
                            taxRate: l.taxRate ?? 0,
                            taxAmount: l.taxAmount,
                            amount: l.amount,
                        })),
                    },
                },
                select: { id: true, reference: true },
            });

            let dealId: number | null = null;
            if (hasParty && entry && actor) {
                const open = await findOpenDealForParty(tx, { personId, companyId });
                if (open) {
                    dealId = open.id;
                } else {
                    const deal = await tx.deal.create({
                        data: {
                            pipelineId: pipeline!.id,
                            status: entry.id,
                            title: `Estimate — ${partyName || "Customer"}${firstName ? ` (${firstName})` : ""}`,
                            contactName: partyName || null,
                            phone: partyPhone || null,
                            personId,
                            companyId,
                            valuePaise: Math.round(totalAmount * 100),
                            source: "POS Estimate",
                            createdBy: actor,
                        },
                        select: { id: true },
                    });
                    dealId = deal.id;
                }
                await tx.dealActivity.create({
                    data: {
                        dealId,
                        author: actor,
                        kind: "SYSTEM",
                        body: `Estimate ${reference} created (₹${totalAmount.toFixed(2)})${notes ? ` — ${notes}` : ""}`,
                    },
                });
                await tx.invVoucher.update({ where: { id: voucher.id }, data: { dealId } });
            }

            return { voucherId: voucher.id, reference: voucher.reference, dealId };
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save estimate");
    }
}
