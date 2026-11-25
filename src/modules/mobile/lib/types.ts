import type { PhotoGuide } from "./photoGuide";
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

/** /api/mobile/vouchers/[id] — one voucher, opened from a party's Vouchers tab or the Day Book. */
export type VoucherView = {
    id: number;
    kind: string;
    ref: string;
    date: string;
    /** When it was actually saved (a till's own clock), else when it reached the office. */
    savedAt: string;
    by: string | null;
    status: string;
    party: string | null;
    narration: string | null;
    /** Goods lines; empty on a Receipt / Payment / Journal. `rate` is the price
     *  per piece with GST and line discount (amount ÷ qty). */
    items: { name: string; note: string | null; qty: number; freeQty: number; rate: number; amount: number }[];
    /** Services and "+ Add Account" rows (a coupon is a negative one), with GST. */
    charges: { name: string; qty: number | null; rate: number | null; amount: number }[];
    /** Bill figures — null when the voucher is not a bill (no trade detail).
     *  items + charges − discount + shipping + roundOff = total; `tax` is inside them. */
    bill: { discount: number; shipping: number; tax: number; roundOff: number; total: number } | null;
    /** How a bill was paid, ledger by ledger; empty = nothing taken (on credit). */
    paid: { name: string; amount: number }[];
    /** The voucher's ledger legs — what a Receipt / Payment / Journal shows. */
    legs: { name: string; side: "Dr" | "Cr"; amount: number }[];
};

/** /api/mobile/photos/product/[id] — one product's shop photos, main first. A save
 *  also sends `wasListedInShop`, so the phone can say the product went live on the
 *  shop (or came off it) because of the photo. */
export type ProductPhotos = {
    id: number;
    name: string;
    sku: string;
    galleryUrls: string[];
    isListedInShop: boolean;
    wasListedInShop?: boolean;
    /** GET only — stage and notes telling staff what to shoot (photoGuide.ts). */
    guide?: PhotoGuide;
};

/** /api/mobile/photos/master/[kind]/[id] — a brand, group or category after its image changed. */
export type MasterPhoto = { id: number; name: string; imageUrl: string | null };
