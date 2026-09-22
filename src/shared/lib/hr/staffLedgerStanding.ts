// Where a staff member stands on their own "Salary Payable" ledger.
//
// The account is a LIABILITY: a credit balance (positive here) is salary the
// shop still owes them, a debit balance (negative) is an advance they are
// holding against pay not yet earned. Two screens say this — the Job tab's
// ledger line and the Staff Directory row — so the reading lives in one place
// and they cannot drift apart.

export type StaffStanding = "payable" | "advance" | "settled";

export interface StaffLedgerStanding {
    standing: StaffStanding;
    /** Always positive — the sign is carried by `standing`, not the number. */
    amount: number;
    /** One word for a chip: "payable", "advance", or "" when settled. */
    tag: string;
    /** The full sentence the Job tab reads out. */
    sentence: string;
}

export function staffLedgerStanding(balance: number, fmt: (n: number) => string): StaffLedgerStanding {
    if (balance === 0) {
        return { standing: "settled", amount: 0, tag: "", sentence: "nothing outstanding" };
    }
    if (balance > 0) {
        return { standing: "payable", amount: balance, tag: "payable", sentence: `${fmt(balance)} owed to them` };
    }
    const advance = Math.abs(balance);
    return { standing: "advance", amount: advance, tag: "advance", sentence: `${fmt(advance)} advance held` };
}
