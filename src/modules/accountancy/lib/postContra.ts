// ── postContra — single source of truth for posting a Contra voucher ─────────
//
// A "Contra" in Tally parlance is a movement between two cash/bank accounts
// (Cash → Bank deposit, Bank → Cash withdrawal, Cash A → Cash B handover).
// The double-entry shape is always Dr destination / Cr source, summing to zero.
//
// This helper bundles the four-step ritual that every Contra posting needs:
//   1. Generate a sequential reference (`CV-2026-NNNN`)
//   2. Create the `Voucher` row with `type = CONTRA`, `status = POSTED`
//   3. Create the mirror `JournalEntry` so reports / Day Book see it
//   4. Update `Account.balance` for each affected ledger
//
// Used by:
//   • POST `/api/accountancy/vouchers` + `[id]/post`  — the existing Contra
//     dialog at /office/accountancy/cash-book etc. The two-step route
//     pattern (create DRAFT → post) is preserved at the HTTP layer for
//     other voucher types; CONTRA-only the dialog hits this helper.
//   • POST `/api/pos/shifts`        — opening float (Vault → Till)
//   • PATCH `/api/pos/shifts/[id]/close` — handover (Till → Vault)
//
// Returns the `voucherId`, `journalEntryId`, and the generated `reference`
// so callers can persist the back-link (e.g. `PosShift.openingContraVoucherId`).

import { Prisma } from "@/generated/prisma/client";
import {
    balanceDelta, isBalanced, nextRef, nextRefFromSeries, toNumber,
} from "@/modules/accountancy/lib/balance";

export type ContraLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number;             // rupees (Decimal-friendly)
    description?: string | null;
};

export type PostContraInput = {
    /** YYYY-MM-DD or Date — the GL date of the movement. */
    date:        string | Date;
    /** Free-text describing the transfer (e.g. "Shift #42 opening float"). */
    narration?:  string | null;
    /** Optional party account (rarely set for Contras; kept for completeness). */
    partyAccountId?: number | null;
    /** Balanced double-entry lines — Dr destination, Cr source. ≥ 2 lines, ΣDr = ΣCr. */
    lines:       ContraLine[];
    /** User performing the action. Becomes `Voucher.createdById`. */
    userId:      number;
};

export type PostContraResult = {
    voucherId:      number;
    journalEntryId: number;
    reference:      string;
};

/**
 * Create & immediately POST a Contra voucher inside the caller's transaction.
 * Throws if `lines` is unbalanced or has < 2 entries — same contract as the
 * existing `POST /api/accountancy/vouchers` route, just programmatic.
 */
export async function postContra(
    tx: Prisma.TransactionClient,
    input: PostContraInput,
): Promise<PostContraResult> {
    if (input.lines.length < 2) {
        throw new Error("Contra needs at least 2 lines (Dr destination + Cr source).");
    }
    if (!isBalanced(input.lines)) {
        throw new Error("Contra is not balanced — debits must equal credits.");
    }

    const date = typeof input.date === "string" ? new Date(input.date) : input.date;
    const totalAmount = input.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + toNumber(l.amount), 0);

    // 1. Sequential reference
    const reference = await nextRefFromSeries(tx, "CONTRA", input.userId);

    // 2. Voucher (POSTED — Contra is never drafted via the helper)
    const voucher = await tx.voucher.create({
        data: {
            type:           "CONTRA",
            reference,
            date,
            narration:      input.narration ?? null,
            partyAccountId: input.partyAccountId ?? null,
            totalAmount,
            status:         "POSTED",
            postedAt:       new Date(),
            createdById:    input.userId,
            lines: {
                create: input.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                })),
            },
        },
        select: { id: true },
    });

    // 3. Mirror JE — required to surface in Day Book / ledger reports
    //    (the Voucher table alone is treated as draft-ish by some reports).
    const jeRef = await nextRef(tx, "journalEntry", "JE");
    const je = await tx.journalEntry.create({
        data: {
            date,
            reference:   jeRef,
            description: `CONTRA ${reference}: ${input.narration ?? ""}`.trim(),
            status:      "POSTED",
            postedAt:    new Date(),
            createdById: input.userId,
            lines: {
                create: input.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                })),
            },
        },
        select: { id: true },
    });

    // Wire back the JE reference on the Voucher (consumed by some reports).
    await tx.voucher.update({
        where: { id: voucher.id },
        data:  { journalEntryId: je.id },
    });

    // 4. Account.balance deltas — need each account's normalBalance to know
    //    whether DEBIT increases or decreases the running balance.
    const accountIds = input.lines.map((l) => l.accountId);
    const accounts = await tx.account.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, normalBalance: true },
    });
    const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));

    for (const line of input.lines) {
        const normal = normalById.get(line.accountId);
        if (!normal) throw new Error(`Account ${line.accountId} has no normalBalance set — cannot post Contra`);
        const delta = balanceDelta(normal, line.type, toNumber(line.amount));
        await tx.account.update({
            where: { id: line.accountId },
            data:  { balance: { increment: delta } },
        });
    }

    return { voucherId: voucher.id, journalEntryId: je.id, reference };
}
