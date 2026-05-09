export type LineForBalance = {
    type: "DEBIT" | "CREDIT";
    amount: { toString(): string } | number | string;
};

export function toNumber(v: { toString(): string } | number | string): number {
    return typeof v === "number" ? v : Number(v);
}

/** Delta to apply to GlAccount.balance when posting a line. */
export function balanceDelta(
    normalBalance: "DEBIT" | "CREDIT",
    entryType: "DEBIT" | "CREDIT",
    amount: number,
): number {
    if (normalBalance === "DEBIT") {
        return entryType === "DEBIT" ? amount : -amount;
    }
    return entryType === "CREDIT" ? amount : -amount;
}

/** True when sum(debits) === sum(credits) within a rounding tolerance. */
export function isBalanced(lines: LineForBalance[]): boolean {
    let net = 0;
    for (const l of lines) {
        const amt = toNumber(l.amount);
        net += l.type === "DEBIT" ? amt : -amt;
    }
    return Math.abs(net) < 0.005;
}

/** Compute closing balance for an account from a set of lines. */
export function computeBalance(
    normalBalance: "DEBIT" | "CREDIT",
    lines: LineForBalance[],
): number {
    let debits = 0;
    let credits = 0;
    for (const l of lines) {
        const amt = toNumber(l.amount);
        if (l.type === "DEBIT") debits += amt;
        else credits += amt;
    }
    return normalBalance === "DEBIT" ? debits - credits : credits - debits;
}

/**
 * Atomically increment nextSeq for the given kind and return the formatted reference.
 * Must be called inside a prisma.$transaction callback.
 *
 * Behavior:
 *  1. If the year-closing date has passed → advance fyStartYear by 1, push the
 *     closing date forward by 1 year, reset nextSeq to 0.
 *  2. Atomically increment nextSeq.
 *  3. Assemble the reference from configured parts.
 *
 * Throws if the VoucherSeries row is missing — visit Settings → Year Ending.
 */
export async function nextRefFromSeries(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    kind: string,
    userId?: number | null,
): Promise<string> {
    const { assembleReference, fyClosingDate } = await import("./voucherRef");

    // Load the org-level books config (singleton). Auto-create on first call
    // so a fresh install never throws.
    const config = await tx.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });

    // Read once to check rollover. We do this BEFORE the atomic increment so
    // that the reset (nextSeq → 0) and the increment can happen together.
    const current = await tx.voucherSeries.findUnique({ where: { kind } });
    if (!current) {
        throw new Error(`VoucherSeries for kind '${kind}' not found. Visit Settings → Year Ending to initialise.`);
    }

    const today = new Date();
    if (current.fyStartYear != null) {
        const closing = fyClosingDate(current.fyStartYear, config.restartMonth, config.restartDay);
        if (today > closing) {
            await tx.voucherSeries.update({
                where: { kind },
                data: {
                    fyStartYear: current.fyStartYear + 1,
                    nextSeq:     0,
                },
            });
        }
    }

    // Atomic post-increment
    const series = await tx.voucherSeries.update({
        where: { kind },
        data: { nextSeq: { increment: 1 } },
    });

    return assembleReference(series, userId);
}

/**
 * @deprecated Use nextRefFromSeries() instead.
 * Generate sequential reference numbers: e.g. JE-2026-0001
 */
export async function nextRef(
    tx: { journalEntry: { count: (a: object) => Promise<number> } } | { invoice: { count: (a: object) => Promise<number> } },
    model: "journalEntry" | "invoice",
    prefix: string,
): Promise<string> {
    const year = new Date().getFullYear();
    const startsWith = `${prefix}-${year}-`;
    const count =
        model === "journalEntry"
            ? await (tx as { journalEntry: { count: (a: object) => Promise<number> } }).journalEntry.count({
                where: { reference: { startsWith } },
            })
            : await (tx as { invoice: { count: (a: object) => Promise<number> } }).invoice.count({
                where: { number: { startsWith } },
            });
    return `${startsWith}${String(count + 1).padStart(4, "0")}`;
}
