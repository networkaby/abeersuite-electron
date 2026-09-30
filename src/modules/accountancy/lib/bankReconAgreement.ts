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

// ── The book-start year's opening ────────────────────────────────────────────
//
// The books begin with an opening balance: the bank's balance at the close of
// the day before the book-start year. Statement lines dated before that year
// are therefore already inside the opening balance — there is no voucher for
// them and never will be. Once proven (the bank's balance going into the year
// equals the books' opening, to the paisa), they count as explained: not "not
// in books", and no bar to the lock. Unproven, nothing is excused, so a wrong
// opening balance still shows as a difference. Only the book-start year needs
// this; every later year runs on from the day before like any other day.

/** 1 April on or before this date — the Indian financial year it falls in. */
export function fyStartOf(iso: string): string {
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    return `${m >= 4 ? y : y - 1}-04-01`;
}

export type OpeningCover = {
    /** First day of the book-start year. */
    fyStart: string;
    /** Books' balance going into that day, signed as the bank sees it. */
    booksOpening: number;
    /** Bank's balance going into that day, or null when the statement cannot say. */
    bankOpening: number | null;
    agrees: boolean;
};

export function openingCover(input: {
    fyStart: string;
    booksOpening: number;
    /** The first statement line on or after `fyStart` — its printed balance and its own signed amount. */
    firstInYear: { balance: number | null; net: number } | null;
    /** The last printed balance before `fyStart`, when the first line in the year has none. */
    lastBeforeYear: number | null;
}): OpeningCover {
    // The bank's opening is read off the first line available in the year —
    // its balance before its own amount — whatever date that line falls on.
    const bankOpening = input.firstInYear?.balance != null
        ? money2(input.firstInYear.balance - input.firstInYear.net)
        : input.lastBeforeYear;
    const booksOpening = money2(input.booksOpening);
    return {
        fyStart: input.fyStart,
        booksOpening,
        bankOpening,
        agrees: bankOpening != null && Math.abs(bankOpening - booksOpening) < EPS,
    };
}

/** A statement line already inside the proven opening balance. */
export function inOpening(dateIso: string, cover: OpeningCover | null): boolean {
    return cover != null && cover.agrees && dateIso < cover.fyStart;
}
