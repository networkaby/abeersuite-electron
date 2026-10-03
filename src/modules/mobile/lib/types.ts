/** Shapes the phone screens read from /api/mobile/*. */

export type PartyBill = {
    key: string;
    /** The spine id a bill-wise settlement links to; null only on pre-spine rows. */
    universalVoucherId: number | null;
    ref: string;
    billDate: string;
    /** When it falls due — the order money is placed on bills (oldest due first).
     *  Absent on a copy saved before it was sent; read the bill date then. */
    dueDate?: string;
    totalAmount: number;
    /** Unsigned; `side` says which way it runs (+1 they owe us, −1 we owe them). */
    outstanding: number;
    side: 1 | -1;
    daysOverdue: number;
};

/** /api/mobile/parties/[accountId] */
export type PartyDetail = {
    accountId: number;
    name: string;
    /** + they owe us, − we owe them. */
    balance: number;
    /** `upi://pay?…` for the party's own UPI ID, or null when none is saved. */
    upiLink: string | null;
    /** The party's numbers, primary first — the Call buttons. */
    phones: { phone: string; label: string | null }[];
    bills: PartyBill[];
};

/** /api/mobile/pay-setup */
export type PaySetup = {
    canPay: boolean;
    canReceive: boolean;
    moneyLedgers: { id: number; name: string; group: string | null }[];
    /** Ledgers a payment can go straight to — Direct / Indirect Expenses and below. */
    expenseLedgers: { id: number; name: string; group: string | null }[];
    branches: { id: string; name: string }[];
    defaultBranchId: string | null;
};
