/**
 * Turn one Vyapar transaction into a TransactionSpec the engine can post.
 *
 * Pure: no database, no side effects, so the arithmetic can be tested on its own.
 * `enginePost()` does the writing.
 *
 * The invoice identity, verified against all 2,094 sales / 57 credit notes / 3
 * debit notes in the window (every one ties to the paisa):
 *
 *     total = Σ line.total_amount − discount + roundOff + extraCharges − loyalty
 *
 * Three parts of that were not obvious and each would have been wrong:
 *   • `line.total_amount` INCLUDES tax, so taxable = lineTotal − lineTax
 *   • `loyalty_amount` is points SPENT, reducing what the customer pays — miss it
 *     and 758 of 2,094 sales fail to balance
 *   • tax is only ever on the LINE (`lineitem_tax_amount`); `txn_tax_amount` is zero
 *     on all 23,551 rows in this file
 *
 * A voucher with no lines at all is legitimate — a ₹500 cash purchase described as
 * "HEAD CABL CHANGE KORA HOISE" with no itemisation — and its whole total is taxable.
 */

import type { EngineGlLine, EngineStockMoveSpec, TransactionSpec } from "@/modules/accountancy/lib/transactionEngine";

export type VyaparTxn = {
    txnId: number;
    type: number;
    date: Date;
    ref: string | null;
    description: string | null;
    partyAccountId: number | null;
    /** Vyapar's own split of the invoice: settled now vs owed. */
    cash: number;
    balance: number;
    discount: number;
    roundOff: number;
    charges: number;
    loyalty: number;
    /** Expense head (type 7) or income head (type 29). */
    headAccountId: number | null;
    tenders: Array<{ accountId: number; amount: number }>;
    lines: Array<{
        productId: number;
        qty: number;
        /** Tax-INCLUSIVE line total, as Vyapar stores it. */
        total: number;
        tax: number;
        /** True when the line's tax code is IGST rather than CGST+SGST. */
        igst: boolean;
    }>;
};

export type Ledgers = {
    sales: number; salesReturns: number; purchases: number; purchaseReturns: number;
    cgst: number; sgst: number; igst: number; roundOff: number;
    discountAllowed: number; discountReceived: number;
    loyaltyRedeemed: number; shippingIncome: number; freightInward: number;
    fixedAsset: number;
    /** Where a purchase with NO line items goes — it bought a service, not goods. */
    serviceExpense: number;
};

export type BuiltVoucher = {
    spec: TransactionSpec;
    /** How far off balance the known legs were before Round Off absorbed it. */
    residual: number;
};

/** Rounding noise Round Off may absorb. Anything larger is a modelling error, not a rounding one. */
export const ROUNDING_TOLERANCE = 2;

const r2 = (n: number) => Math.round(n * 100) / 100;

export class SpecError extends Error {}

export function buildSpec(
    t: VyaparTxn,
    L: Ledgers,
    branchId: string,
    opts: { stockDate: Date },
): BuiltVoucher {
    const gl: EngineGlLine[] = [];
    const stock: EngineStockMoveSpec[] = [];

    const lineTotal = r2(t.lines.reduce((s, l) => s + l.total, 0));
    const lineTax = r2(t.lines.reduce((s, l) => s + l.tax, 0));
    const igstTax = r2(t.lines.filter((l) => l.igst).reduce((s, l) => s + l.tax, 0));
    const gstTax = r2(lineTax - igstTax);
    // No lines means no tax breakdown, so the whole total is the taxable value.
    const taxable = t.lines.length ? r2(lineTotal - lineTax) : r2(t.cash + t.balance);
    const total = r2(t.cash + t.balance);

    const dr = (accountId: number, amount: number, description?: string) => {
        if (Math.abs(amount) < 0.005) return;
        gl.push(amount > 0
            ? { accountId, type: "DEBIT", amount: r2(amount), description }
            : { accountId, type: "CREDIT", amount: r2(-amount), description });
    };
    const cr = (accountId: number, amount: number, description?: string) => dr(accountId, -amount, description);

    const tenderLegs = (sign: 1 | -1) => {
        for (const x of t.tenders) dr(x.accountId, sign * x.amount, "tender");
    };
    const taxLegs = (sign: 1 | -1) => {
        // CGST and SGST split the tax evenly; IGST replaces both on inter-state sales.
        dr(L.cgst, sign * r2(gstTax / 2), "CGST");
        dr(L.sgst, sign * r2(gstTax - r2(gstTax / 2)), "SGST");
        dr(L.igst, sign * igstTax, "IGST");
    };
    const stockLegs = (dir: "in" | "out") => {
        for (const l of t.lines) {
            const value = r2(l.total - l.tax);
            const qty = Math.abs(l.qty);
            if (qty === 0) continue;
            stock.push({
                productId: l.productId, branchId, date: opts.stockDate,
                inQty: dir === "in" ? qty : 0,
                outQty: dir === "out" ? qty : 0,
                rate: qty ? r2(value / qty) : 0,
                amount: value,
            });
        }
    };

    let type: string;
    switch (t.type) {
        case 1:   // Sale
            type = "SALE";
            tenderLegs(+1);
            dr(t.partyAccountId ?? 0, t.balance, "outstanding");
            dr(L.discountAllowed, t.discount, "discount allowed");
            dr(L.loyaltyRedeemed, t.loyalty, "loyalty points redeemed");
            cr(L.sales, taxable);
            taxLegs(-1);
            // Shipping charged TO the customer is revenue.
            cr(L.shippingIncome, t.charges, "extra charges");
            stockLegs("out");
            break;

        case 2:   // Purchase
            type = "PURCHASE";
            // A purchase with no line items bought no goods. Vyapar allows a bill with
            // a total and nothing itemised, and this business uses it for repairs --
            // txn 23975, "HEAD CABL CHANGE KORA HOISE", a printer head-cable change.
            // Sending that to Purchase A/c would put a repair into cost of goods and
            // overstate purchases; it belongs in an expense ledger.
            dr(t.lines.length ? L.purchases : L.serviceExpense, taxable);
            taxLegs(+1);                                  // input tax is recoverable
            // Freight the SUPPLIER charged us is a cost of buying, not revenue. Booking
            // it to Shipping Income put ₹472 on the wrong side and threw one purchase
            // ₹944 out of balance — twice the charge, which is the signature of a
            // sign error rather than a missing leg.
            dr(L.freightInward, t.charges, "inward freight");
            cr(t.partyAccountId ?? 0, t.balance, "outstanding");
            tenderLegs(-1);
            cr(L.discountReceived, t.discount, "discount received");
            stockLegs("in");
            break;

        case 21:  // Credit Note — a sale coming back
            type = "SALE_RETURN";
            dr(L.salesReturns, taxable);
            taxLegs(+1);                                  // output tax reversed
            cr(t.partyAccountId ?? 0, t.balance, "refund owed");
            tenderLegs(-1);
            // A return must unwind the SAME legs the sale created, not just revenue.
            // 13 of 57 credit notes carry a loyalty amount and 3 a discount: where the
            // original was part-paid in points, only the cash part comes back and the
            // points are restored. One credit note decomposed exactly — line 1,050 less
            // 70 of points equals the 980 owed — and without these legs it missed by
            // precisely that 70.
            cr(L.loyaltyRedeemed, t.loyalty, "loyalty points restored");
            cr(L.discountAllowed, t.discount, "discount reversed");
            cr(L.shippingIncome, -t.charges, "charges reversed");
            stockLegs("in");
            break;

        case 23:  // Debit Note — goods going back to the supplier
            type = "PURCHASE_RETURN";
            dr(t.partyAccountId ?? 0, t.balance, "recoverable");
            tenderLegs(+1);
            cr(L.purchaseReturns, taxable);
            taxLegs(-1);                                  // input tax reversed
            dr(L.discountReceived, t.discount, "discount reversed");
            dr(L.freightInward, -t.charges, "inward freight reversed");
            stockLegs("out");
            break;

        case 3:   // Payment-In
            type = "RECEIPT";
            tenderLegs(+1);
            cr(t.partyAccountId ?? 0, total, "received");
            break;

        case 4:   // Payment-Out
            type = "PAYMENT";
            dr(t.partyAccountId ?? 0, total, "paid");
            tenderLegs(-1);
            break;

        case 7:   // Expense
            type = "JOURNAL";
            if (t.headAccountId == null) throw new SpecError(`expense ${t.txnId} has no head`);
            dr(t.headAccountId, total, t.description ?? "expense");
            tenderLegs(-1);
            cr(t.partyAccountId ?? 0, t.balance, "unpaid expense");
            break;

        case 60:  // Sale of a fixed asset
            type = "JOURNAL";
            tenderLegs(+1);
            dr(t.partyAccountId ?? 0, t.balance, "receivable");
            cr(L.fixedAsset, total, t.description ?? "fixed asset sold");
            break;

        case 61:  // Purchase of a fixed asset
            // Must be posted, not skipped. The opening roll-back subtracts every type
            // in PARTY_EFFECT, so any type it subtracts and the replay does not post
            // leaves the party short by exactly that amount — Amazon Retail was out by
            // its ₹2,699 for precisely this reason. Asymmetry between the two halves is
            // its own class of bug.
            type = "JOURNAL";
            dr(L.fixedAsset, total, t.description ?? "fixed asset purchased");
            cr(t.partyAccountId ?? 0, t.balance, "payable");
            tenderLegs(-1);
            break;

        case 29:  // Other income
            type = "JOURNAL";
            if (t.headAccountId == null) throw new SpecError(`income ${t.txnId} has no head`);
            tenderLegs(+1);
            cr(t.headAccountId, total, t.description ?? "other income");
            break;

        default:
            throw new SpecError(`type ${t.type} has no spec builder`);
    }

    // Whatever the known legs failed to balance is rounding — post it to Round Off
    // rather than leaving the voucher unbalanced. The caller checks the size: a few
    // paise is Vyapar's own rounding, anything more is a modelling error wearing a
    // rounding costume, and must not be quietly absorbed.
    const debits = gl.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
    const credits = gl.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);
    const residual = r2(debits - credits);
    if (Math.abs(residual) >= 0.005) cr(L.roundOff, residual, "round off");

    return {
        spec: {
            type,
            date: t.date,
            reference: t.ref ?? undefined,
            narration: t.description ?? null,
            description: `${type} ${t.ref ?? t.txnId}`,
            glLines: gl,
            stockMoves: stock,
        },
        residual,
    };
}
