// The single ledger-inclusion gate, on its own.
//
// Lifted out of `aggregateLedger.ts` so it can be used without dragging that
// module's dependencies in with it: `aggregateLedger` reaches (through
// `balance.ts` → `releaseGuard` → `replicaReadiness`) into `server-only`, which
// makes anything importing it unusable from a plain `tsx` script. This gate is a
// three-line pure predicate with type-only imports, so a caller that needs
// nothing else should pay for nothing else.
//
// `aggregateLedger` re-exports both names, so every existing importer is
// unchanged — there is still exactly one definition.

import type { Prisma, VoucherStatus } from "@/generated/prisma/client";

export type LedgerMode = "posted" | "provisional";

/**
 * The single ledger-inclusion gate for universal-voucher reads. `posted`
 * (default) = POSTED only (the books); `provisional` also includes DRAFT
 * (Tally-Scenario what-if). CANCELLED / soft-deleted are never counted. Every GL
 * reader — Balance Sheet, P&L, Trial Balance, Day Book, ledger, cash-flow,
 * recompute-balances, till-ledger — spreads this into its `universalVoucher`
 * filter so they agree by construction.
 */
export function ledgerStatusFilterUv(mode: LedgerMode = "posted"): Prisma.UniversalVoucherWhereInput {
    return mode === "provisional"
        ? { status: { in: ["POSTED", "DRAFT"] as VoucherStatus[] } }
        : { status: "POSTED" as VoucherStatus };
}
