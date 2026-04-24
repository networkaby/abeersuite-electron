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

/** Generate sequential reference numbers: e.g. JE-2026-0001 */
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
