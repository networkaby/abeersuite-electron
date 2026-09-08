import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucherKind } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { assertLinkPlan, createLink, BillLinkError } from "@/modules/accountancy/lib/billLink";

// A link is a statement about two POSTED vouchers, so it is gated at the same
// rung as editing one: `cancel` on BOTH kinds.
//
// `userCanVoucherKind`, NOT `userCanVoucher`: the latter returns false for kinds
// with no matrix row, which would make every POS bill unlinkable by anyone — and
// POS bills are precisely the ones carrying counter dues. The kind-less variant
// passes those through, gated by their own flow, exactly as the create/post
// routes do.
function canLink(user: Parameters<typeof userCanVoucherKind>[0], types: string[]): boolean {
    return types.every((t) => userCanVoucherKind(user, t, "cancel"));
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
    /**
     * What `amount` means on each line:
     *
     *   • `set` (the default) — what the pair should TOTAL once this is saved.
     *     Saving the same plan twice therefore changes nothing, which is what
     *     makes a double click, a retry after a lost response, or a replayed
     *     request harmless.
     *   • `increment` — add this much to whatever the pair already has. Only for
     *     a caller that genuinely means "some more", and cannot be replayed
     *     safely.
     */
    mode: z.enum(["set", "increment"]).default("set"),
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
            // Everything about a link is measured on ONE party ledger, so one
            // lock per party is enough to stop two tills reading the same room
            // and both spending it. The unique key alone would not: it stops a
            // second ROW for a pair, not a doubled amount on the one row.
            // Two-argument form, not hashtext() — the single-argument namespace
            // is global and already used elsewhere for voucher numbering.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711, ${data.accountId})`;

            // Validated as a whole: every rule the per-link loop applied, plus
            // the linking voucher checked once against everything the plan puts
            // on it, and read in a handful of queries instead of ~7 per line.
            const plan = await assertLinkPlan(tx, {
                accountId: data.accountId,
                voucherId: data.voucherId,
                links:     data.links,
                mode:      data.mode,
            });

            const out: number[] = [];
            for (const link of plan) {
                out.push(await createLink(tx, {
                    targetId:  link.targetId,
                    sourceId:  link.sourceId,
                    amount:    link.amount,
                    reference: data.reference ?? null,
                    userId:    user!.id,
                    mode:      data.mode,
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
