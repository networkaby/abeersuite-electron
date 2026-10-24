import type { Prisma } from "@/generated/prisma/client";

/**
 * The branch a voucher is stamped with when there is NO user and therefore no
 * working branch to read — background jobs only (gift-card breakage expiry, and
 * any future cron that posts). Interactive writes must never come here: they go
 * through `requireWritableBranchId`, which refuses "All branches" outright so the
 * user picks a real one.
 *
 * Every voucher carries a branch from 2026-09-17. "Org-level, no branch" used to
 * be a real state and is not any more — a blank branch quietly dropped those
 * vouchers out of every branch-wise report. The rule lives in the application
 * (this helper, `requireWritableBranchId`, and `branchId` being a required engine
 * argument); the column itself stays nullable, because a counter replica cannot
 * be handed a nullability change without halting the till — see the note on
 * `UniversalVoucher.branchId` in prisma/schema/finance.prisma.
 *
 * Resolves `BR-HQ` (Head Office, seeded in bootstrap-seed.ts) and falls back to
 * the lowest-numbered branch so a database seeded under another id still posts
 * rather than failing the foreign key.
 */
export const HEAD_OFFICE_BRANCH_ID = "BR-HQ";

export async function systemBranchId(tx: Prisma.TransactionClient): Promise<string> {
    const hq = await tx.branch.findUnique({
        where:  { id: HEAD_OFFICE_BRANCH_ID },
        select: { id: true },
    });
    if (hq) return hq.id;

    const first = await tx.branch.findFirst({
        orderBy: { number: "asc" },
        select:  { id: true },
    });
    if (!first) {
        throw new Error("No branch exists — a voucher cannot be posted before a branch is set up.");
    }
    return first.id;
}
