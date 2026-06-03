// Additional-cost (shipping/courier) pool — the read side of the pricing-strategy
// decision-support layer.
//
// HARD RULE: this module is READ-ONLY relative to the GL. It only reads POSTED
// `JournalLine` debits under the nominated pool AccountGroup and the
// `CostPoolDraw` rows that consume them. It NEVER writes a journal entry / line.
//
// A "pool entry" = one POSTED debit to a ledger in OrgDefaults.shippingPoolGroup.
// Each entry is consumed by CostPoolDraw rows:
//   ALLOCATION → a per-unit surcharge attributed to a product (pricing).
//   DISMISSAL  → written off as office expense (leaves the waiting list).
// Per entry: remaining = lineAmount − Σ(draws.amountPaise). Waiting = remaining > 0.
//
// DERIVE RULE for a product's current additional cost = the MOST RECENT
// ALLOCATION draw's `perUnitPaise` (mirrors LAST_INWARD). To switch to
// SUM / AVG / date-windowed, edit ONLY `getCurrentAdditionalCostByProduct`.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

/** Decimal rupees → integer paise. Matches resolveCost.ts's boundary convention. */
function rupeesToPaise(d: unknown): number {
    return Math.round(toNumber(d as never) * 100);
}

export interface PoolEntry {
    journalLineId: number;
    /** ISO date of the posted entry. */
    date: string;
    ledgerId: number;
    ledgerName: string;
    /** The originating VOUCHER number (Payment / Purchase / Journal …) — NOT the
     *  internal GL JournalEntry reference, which is never surfaced to users. */
    reference: string;
    referenceType: string | null;
    amountPaise: number;
    allocatedPaise: number;
    dismissedPaise: number;
    remainingPaise: number;
}

export interface PoolSummary {
    configured: boolean;
    groupId: number | null;
    groupName: string | null;
    /** Leaf ledgers under the pool group (display / info). */
    ledgers: { id: number; name: string }[];
    /** Entries with remaining > 0 — the waiting list. */
    entries: PoolEntry[];
    poolTotalPaise: number;
    allocatedTotalPaise: number;
    dismissedTotalPaise: number;
    waitingTotalPaise: number;
}

/** The nominated pool group id, or null when the feature is unconfigured. */
export async function getShippingPoolGroupId(): Promise<number | null> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { shippingPoolGroupId: true },
    });
    return od?.shippingPoolGroupId ?? null;
}

/** Accounts (ledgers) under a group + all its descendant groups. */
async function getPoolLedgers(groupId: number): Promise<{ id: number; name: string }[]> {
    const allGroups = await prisma.accountGroup.findMany({ select: { id: true, parentId: true } });
    const childMap = new Map<number, number[]>();
    for (const g of allGroups) {
        if (g.parentId === null) continue;
        const arr = childMap.get(g.parentId) ?? [];
        arr.push(g.id);
        childMap.set(g.parentId, arr);
    }
    const groupIds: number[] = [groupId];
    const stack = [groupId];
    while (stack.length) {
        const top = stack.pop()!;
        const kids = childMap.get(top) ?? [];
        groupIds.push(...kids);
        stack.push(...kids);
    }
    return prisma.account.findMany({
        where: { groupId: { in: groupIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
}

/**
 * Resolve each GL `JournalEntry` back to the VOUCHER that created it, so the UI
 * shows the real document number (Payment / Purchase / Journal …) instead of the
 * internal `GL-…` reference. A `Voucher` (Payment/Receipt/Contra/JV) wins over an
 * `InvVoucher` (Purchase/Sale…) on the rare chance both point at the same JE.
 * Returns Map<journalEntryId, { ref, type }>. Entries with no originating voucher
 * (e.g. a raw engine/manual JE) are simply absent → caller shows "—".
 *
 * NOTE: the GL reference itself is intentionally NOT exposed here — surfacing GL
 * numbers to normal users is a separate admin-diagnosis concern (TODO).
 */
export async function resolveSourceVoucherRefs(
    jeIds: number[],
): Promise<Map<number, { ref: string; type: string }>> {
    const out = new Map<number, { ref: string; type: string }>();
    const ids = [...new Set(jeIds)];
    if (ids.length === 0) return out;
    const [vouchers, invVouchers] = await Promise.all([
        prisma.voucher.findMany({
            where: { journalEntryId: { in: ids } },
            select: { journalEntryId: true, reference: true, type: true },
        }),
        prisma.invVoucher.findMany({
            where: { journalEntryId: { in: ids } },
            select: { journalEntryId: true, reference: true, type: true },
        }),
    ]);
    for (const v of invVouchers) if (v.journalEntryId != null) out.set(v.journalEntryId, { ref: v.reference, type: v.type });
    for (const v of vouchers) if (v.journalEntryId != null) out.set(v.journalEntryId, { ref: v.reference, type: v.type });
    return out;
}

/**
 * Full pool snapshot: waiting entries (remaining > 0) + summary totals.
 * `asOf` optionally caps which posted debits are considered (defaults to all).
 */
export async function getPoolSummary(asOf?: Date): Promise<PoolSummary> {
    const groupId = await getShippingPoolGroupId();
    if (groupId == null) {
        return {
            configured: false, groupId: null, groupName: null, ledgers: [],
            entries: [], poolTotalPaise: 0, allocatedTotalPaise: 0,
            dismissedTotalPaise: 0, waitingTotalPaise: 0,
        };
    }

    const [group, ledgers] = await Promise.all([
        prisma.accountGroup.findUnique({ where: { id: groupId }, select: { name: true } }),
        getPoolLedgers(groupId),
    ]);
    const ledgerIds = ledgers.map((l) => l.id);

    // Every POSTED debit to a pool ledger = one pool entry.
    const lines = ledgerIds.length === 0 ? [] : await prisma.journalLine.findMany({
        where: {
            type: "DEBIT",
            accountId: { in: ledgerIds },
            journalEntry: { status: "POSTED", deletedAt: null, ...(asOf ? { date: { lte: asOf } } : {}) },
        },
        select: {
            id: true,
            amount: true,
            accountId: true,
            journalEntryId: true,
            account: { select: { name: true } },
            journalEntry: { select: { date: true } },
        },
        orderBy: { id: "desc" },
    });

    // Resolve each entry's originating voucher number (never surface GL refs).
    const refMap = await resolveSourceVoucherRefs(lines.map((l) => l.journalEntryId));

    // Sum draws per source line + kind.
    const lineIds = lines.map((l) => l.id);
    const drawSums = lineIds.length === 0 ? [] : await prisma.additionalCostAllocation.groupBy({
        by: ["sourceJournalLineId", "kind"],
        _sum: { amountPaise: true },
        where: { sourceJournalLineId: { in: lineIds } },
    });
    const allocByLine = new Map<number, number>();
    const dismissByLine = new Map<number, number>();
    for (const d of drawSums) {
        const sum = d._sum.amountPaise ?? 0;
        if (d.kind === "ALLOCATION") allocByLine.set(d.sourceJournalLineId, sum);
        else dismissByLine.set(d.sourceJournalLineId, sum);
    }

    let poolTotalPaise = 0, allocatedTotalPaise = 0, dismissedTotalPaise = 0, waitingTotalPaise = 0;
    const entries: PoolEntry[] = [];
    for (const l of lines) {
        const amountPaise = rupeesToPaise(l.amount);
        const allocatedPaise = allocByLine.get(l.id) ?? 0;
        const dismissedPaise = dismissByLine.get(l.id) ?? 0;
        const remainingPaise = amountPaise - allocatedPaise - dismissedPaise;
        poolTotalPaise += amountPaise;
        allocatedTotalPaise += allocatedPaise;
        dismissedTotalPaise += dismissedPaise;
        if (remainingPaise > 0) {
            waitingTotalPaise += remainingPaise;
            const vref = refMap.get(l.journalEntryId);
            entries.push({
                journalLineId: l.id,
                date: l.journalEntry.date.toISOString(),
                ledgerId: l.accountId,
                ledgerName: l.account?.name ?? "—",
                reference: vref?.ref ?? "—",
                referenceType: vref?.type ?? null,
                amountPaise, allocatedPaise, dismissedPaise, remainingPaise,
            });
        }
    }

    return {
        configured: true,
        groupId,
        groupName: group?.name ?? null,
        ledgers,
        entries,
        poolTotalPaise,
        allocatedTotalPaise,
        dismissedTotalPaise,
        waitingTotalPaise,
    };
}

/** Remaining (un-drawn) paise on one posted debit. Used to validate a new draw. */
export async function getEntryRemainingPaise(journalLineId: number): Promise<number | null> {
    const line = await prisma.journalLine.findFirst({
        where: {
            id: journalLineId,
            type: "DEBIT",
            journalEntry: { status: "POSTED", deletedAt: null },
        },
        select: { amount: true },
    });
    if (!line) return null; // not a live pool-eligible debit
    const draws = await prisma.additionalCostAllocation.aggregate({
        _sum: { amountPaise: true },
        where: { sourceJournalLineId: journalLineId },
    });
    return rupeesToPaise(line.amount) - (draws._sum.amountPaise ?? 0);
}

/**
 * Current per-product additional cost (GST-EXCLUSIVE paise).
 *
 * DERIVE RULE = the SUM of every ALLOCATION tied to the product's LATEST inward.
 * One inward (purchase/GRN) can be allocated many times — a single shipment's
 * freight often arrives in legs (vendor-to-airport on the bill, air cargo paid
 * separately, local carrier paid again). All legs of the SAME inward add up. A
 * *newer* purchase replaces an older one (latest inward wins) — older freight
 * doesn't keep stacking.
 *
 * "Latest inward" is keyed by `sourceInvVoucherId` (falling back to the row's
 * `date` for ad-hoc rows with no source voucher); the batch with the most-recent
 * `date` is summed.
 * Products with no allocation are absent from the map (treat as 0 at the call site).
 */
export async function getCurrentAdditionalCostByProduct(
    productIds: number[],
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (productIds.length === 0) return out;
    const rows = await prisma.additionalCostAllocation.findMany({
        where: { kind: "ALLOCATION", productId: { in: productIds }, perUnitPaise: { not: null } },
        select: { productId: true, perUnitPaise: true, sourceInvVoucherId: true, date: true },
        orderBy: [{ productId: "asc" }, { date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });

    // Identity of the inward "batch" a row belongs to (legs of one shipment share it).
    const batchKey = (r: { sourceInvVoucherId: number | null; date: Date }): string =>
        r.sourceInvVoucherId != null ? `v${r.sourceInvVoucherId}` : `d${r.date.toISOString().slice(0, 10)}`;

    const byProduct = new Map<number, typeof rows>();
    for (const r of rows) {
        if (r.productId == null) continue;
        const arr = byProduct.get(r.productId);
        if (arr) arr.push(r); else byProduct.set(r.productId, [r]);
    }
    for (const [pid, prows] of byProduct) {
        const latestKey = batchKey(prows[0]); // prows[0] = most-recent inward (date desc)
        let sum = 0;
        for (const r of prows) {
            if (batchKey(r) === latestKey) sum += r.perUnitPaise ?? 0; // sum all legs of that inward
        }
        out.set(pid, sum);
    }
    return out;
}
