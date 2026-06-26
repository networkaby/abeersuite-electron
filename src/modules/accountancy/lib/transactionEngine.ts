// ── Transaction Engine ────────────────────────────────────────────────────────
//
// The single internal creator/poster for GL ("financial") transactions — the
// `Voucher` table. Consolidates the previously-scattered `tx.voucher.create`
// + post logic behind one entry so there is ONE place the create/post rules
// (and, later, the branch rule) live.
//
// SCOPE (v1): the financial side only. `postFinancialTransaction` is a VERBATIM
// extraction of the `/api/accountancy/vouchers/[id]/post` route's posting body
// (mirror JournalEntry + per-line Account.balance deltas); `createGlVoucher`
// is the verbatim create from `/api/accountancy/vouchers` POST, with an opt-in
// `post` step that delegates to `postFinancialTransaction`. No behaviour change.
//
// NOT here yet (deferred, see docs/plan): branch stamping on the mirror JE,
// the null-normalBalance group-nature fallback, inventory's stock arm, and
// lifecycle (cancel/edit/delete). Each lands as its own isolated change so GL
// parity stays verifiable.
//
// Both functions take an existing `tx` — they are pure transaction steps and
// never open or commit their own transaction (callers own that + the P2028
// timeout tuning).

import type { Prisma, VoucherType } from "@/generated/prisma/client";
import { balanceDelta, nextRefFromSeries, toNumber } from "./balance";
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "./groupNature";

type Drcr = "DEBIT" | "CREDIT";

/** A voucher loaded with the fields the post routine needs.
 * `account.group.type` feeds the null-normalBalance fallback (subsidiary party
 * ledgers carry a null `normalBalance`; their natural side derives from the
 * group). */
export interface PostableVoucher {
    id:        number;
    type:      string;
    reference: string;
    narration: string | null;
    date:      Date;
    lines: {
        accountId:   number;
        type:        Drcr;
        amount:      Prisma.Decimal | number | string;
        description: string | null;
        account:     { normalBalance: Drcr | null; group: { type: GroupTypeStr } | null };
    }[];
}

/**
 * Post a DRAFT financial transaction: create the mirror JournalEntry (for the
 * audit trail / Day Book), apply per-line `Account.balance` deltas, and flip the
 * voucher to POSTED with its `journalEntryId`. Caller must have already loaded
 * + guarded the voucher (DRAFT, not deleted) and must wrap this in a tx.
 *
 * Returns the created JournalEntry id.
 *
 * VERBATIM from the former `/post` route — keep behaviour identical.
 */
export async function postFinancialTransaction(
    tx: Prisma.TransactionClient,
    voucher: PostableVoucher,
    userId: number,
    /** Stamped on the mirror-JE lines for branch-scoped GL reports. Office GL
     * vouchers pass null (org-level); POS callers pass the shift/active branch. */
    branchId: string | null = null,
    /** Posting timestamp. Defaults to now; auto-settled receipts pass the voucher
     * date to preserve their prior `postedAt` semantics. */
    postedAt: Date = new Date(),
): Promise<number> {
    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", userId);
    const je = await tx.journalEntry.create({
        data: {
            date:        voucher.date,
            reference:   jeRef,
            description: `${voucher.type} ${voucher.reference}: ${voucher.narration ?? ""}`.trim(),
            status:      "POSTED",
            postedAt,
            createdById: userId,
            lines: {
                create: voucher.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                    branchId,
                })),
            },
        },
        select: { id: true },
    });

    // Per-line Account.balance deltas. `normalBalance` is null on subsidiary
    // party (AR/AP) ledgers → fall back to the group's natural side (mirrors
    // postReceiptVoucher). A line with neither is skipped rather than mis-posted.
    for (const line of voucher.lines) {
        const side = line.account.normalBalance
            ?? (line.account.group?.type ? defaultNormalBalanceForGroupType(line.account.group.type) : null);
        if (!side) continue;
        const delta = balanceDelta(side, line.type, toNumber(line.amount));
        await tx.account.update({
            where: { id: line.accountId },
            data:  { balance: { increment: delta } },
        });
    }

    await tx.voucher.update({
        where: { id: voucher.id },
        data:  { status: "POSTED", postedAt, journalEntryId: je.id },
    });

    return je.id;
}

export interface CreateGlVoucherSpec {
    type:            VoucherType;
    date:            Date;
    userId:          number;
    lines:           { accountId: number; type: Drcr; amount: number; description?: string | null }[];
    narration?:      string | null;
    partyAccountId?: number | null;
    /** When true, create then immediately post (DRAFT → POSTED) in the same tx. */
    post?:           boolean;
    /** VoucherSeries key for the reference. Defaults to the voucher `type`.
     * The Journal-Voucher dialog passes "JOURNAL" to keep its `JV-…` numbering. */
    referenceSeries?: string;
    /** Branch stamped on the mirror-JE lines when posted (POS callers). */
    branchId?:        string | null;
    /** Posting timestamp when `post` is true. Defaults to now. */
    postedAt?:        Date;
}

/**
 * Create a financial transaction (the `Voucher` row + lines), optionally posting
 * it. `totalAmount` is the sum of debit lines (matches the prior route). Returns
 * the created voucher with its lines (DRAFT snapshot; re-fetch if you need the
 * posted state).
 *
 * VERBATIM from the former `/api/accountancy/vouchers` POST create block.
 */
export async function createGlVoucher(
    tx: Prisma.TransactionClient,
    spec: CreateGlVoucherSpec,
) {
    const totalAmount = spec.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    const reference = await nextRefFromSeries(tx, spec.referenceSeries ?? spec.type, spec.userId);

    const voucher = await tx.voucher.create({
        data: {
            type:           spec.type,
            reference,
            date:           spec.date,
            narration:      spec.narration ?? null,
            partyAccountId: spec.partyAccountId ?? null,
            totalAmount,
            createdById:    spec.userId,
            lines: {
                create: spec.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                })),
            },
        },
        include: { lines: true },
    });

    if (spec.post) {
        const loaded = await tx.voucher.findUnique({
            where:   { id: voucher.id },
            include: { lines: { include: { account: { select: { normalBalance: true, group: { select: { type: true } } } } } } },
        });
        if (loaded) {
            const jeId = await postFinancialTransaction(tx, loaded as unknown as PostableVoucher, spec.userId, spec.branchId ?? null, spec.postedAt ?? new Date());
            // Reflect the posted state on the returned snapshot so callers that
            // need the mirror-JE id (postContra et al.) can read it without a re-fetch.
            voucher.journalEntryId = jeId;
            voucher.status = "POSTED";
        }
    }

    return voucher;
}
