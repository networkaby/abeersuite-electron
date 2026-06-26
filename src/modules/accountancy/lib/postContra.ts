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
import { isBalanced, toNumber } from "@/modules/accountancy/lib/balance";
import { createGlVoucher } from "@/modules/accountancy/lib/transactionEngine";

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

    // Create + post the CONTRA via the Transaction Engine (CV-… reference,
    // mirror JE on the GL_POSTING series, per-line balance deltas).
    const voucher = await createGlVoucher(tx, {
        type:           "CONTRA",
        date,
        userId:         input.userId,
        narration:      input.narration ?? null,
        partyAccountId: input.partyAccountId ?? null,
        lines: input.lines.map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      toNumber(l.amount),
            description: l.description ?? null,
        })),
        post: true,
    });

    return { voucherId: voucher.id, journalEntryId: voucher.journalEntryId!, reference: voucher.reference };
}
