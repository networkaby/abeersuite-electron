// Where books and bank stop agreeing — the rule behind the Balance column's
// colour band on the Bank Reconciliation screen.
//
// Its own file, with no server imports, so it can be run from a plain script
// against real data (like ledgerStatus.ts).

import { money2 } from "@/shared/lib/import/bankStatement";

const EPS = 0.005;

/** The first day that fails, and why. */
export type AgreementBreak = { date: string; gap: number | null; unticked: number };

/**
 * Walk the period day by day and find where books and bank stop agreeing.
 * A day passes when it closes with the bank's printed balance equal to the
 * books' balance AND every row on it — both sides — is ticked. The run ends
 * at the first day that fails either test; `agreedThrough` is the day before.
 *
 * Pure, so the rule can be read and tested without a database. Statement rows
 * must come in statement order (date, then seq) — the last printed balance of
 * a day is its closing balance.
 */
export function agreementRun(input: {
    fromIso: string;
    opening: { amount: number; date: string | null } | null;
    /** Every visible book leg up to `to`, signed as the bank sees it. */
    books: Array<{ date: string; net: number }>;
    /** The period's visible book legs and whether each is ticked. */
    periodBooks: Array<{ date: string; ticked: boolean }>;
    /** Every statement line up to `to`, in statement order. */
    statement: Array<{ date: string; balance: number | null; ticked: boolean }>;
}): { agreedThrough: string | null; breakAt: AgreementBreak | null } {
    const { fromIso } = input;
    // The opening balance counts from its own date, or from the start when undated.
    const legs = input.opening ? [...input.books, { date: input.opening.date ?? "0000-00-00", net: input.opening.amount }] : input.books;
    let books = 0;
    const booksOn = new Map<string, number>();
    for (const l of legs) {
        if (l.date < fromIso) books += l.net;
        else booksOn.set(l.date, (booksOn.get(l.date) ?? 0) + l.net);
    }
    let bank: number | null = null;
    const bankOn = new Map<string, { close: number | null; unticked: number }>();
    for (const s of input.statement) {
        if (s.date < fromIso) { if (s.balance != null) bank = s.balance; continue; }
        const d = bankOn.get(s.date) ?? { close: null, unticked: 0 };
        if (s.balance != null) d.close = s.balance;
        if (!s.ticked) d.unticked++;
        bankOn.set(s.date, d);
    }
    const booksUnticked = new Map<string, number>();
    for (const b of input.periodBooks) {
        if (!b.ticked) booksUnticked.set(b.date, (booksUnticked.get(b.date) ?? 0) + 1);
    }
    const days = [...new Set([...bankOn.keys(), ...booksOn.keys(), ...input.periodBooks.map((b) => b.date)])]
        .filter((d) => d >= fromIso)
        .sort();

    let agreedThrough: string | null = null;
    for (const d of days) {
        books += booksOn.get(d) ?? 0;
        const b = bankOn.get(d);
        if (b?.close != null) bank = b.close;
        const unticked = (b?.unticked ?? 0) + (booksUnticked.get(d) ?? 0);
        const gap = bank == null ? null : money2(bank - books);
        if (unticked > 0 || gap == null || Math.abs(gap) >= EPS) {
            return { agreedThrough, breakAt: { date: d, gap, unticked } };
        }
        agreedThrough = d;
    }
    return { agreedThrough, breakAt: null };
}
