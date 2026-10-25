// ── Shared bits of the A4 renderer ──────────────────────────────────────────
// Used by more than one piece of <A4InvoicePreview> (A4InvoicePreview.tsx):
// the money format, the props every block takes, and which voucher kinds get
// a bespoke middle instead of the goods table.

import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { formatAmount } from "@/shared/lib/format/moneyInr";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";

export const fmtINR = (n: number) =>
    `Rs. ${formatAmount(n)}`;

export type A4ChromeProps = { template: VoucherTemplateDefaults; sample: ThermalReceiptSample };

// Money vouchers get the receipt-book middle (MoneyReceiptMiddle) instead of the goods
// invoice table — a ₹5,000 cash receipt is not a sale and shouldn't look
// like one. Deliberately bespoke; do NOT fold back into DefaultA4Middle.
export const MONEY_RECEIPT_KINDS = new Set(["RECEIPT", "PAYMENT"]);

// Contra print variants that render the bespoke denomination slip: BANK_DEPOSIT
// carries the bank pay-in slip, CASH_HANDOVER the cash→cash handover slip. Both
// go through DepositSlipMiddle, which branches on `sample.depositSlip.mode`.
// Plain CONTRA is NOT here — it keeps the neutral journal table.
export const DEPOSIT_SLIP_KINDS = new Set(["BANK_DEPOSIT", "CASH_HANDOVER"]);

// Journal-style GL vouchers (plain Contra, Journal) — a double-entry document,
// not a sale. They print a Particulars · Debit · Credit ledger table, never the
// goods qty/rate table.
export const JOURNAL_KINDS = new Set(["CONTRA", "JOURNAL"]);
