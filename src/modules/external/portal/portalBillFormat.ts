import { formatInr } from "@/shared/lib/format/moneyInr";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { upiProvider } from "@/modules/pos/lib/paymentLink";
import type { PortalStatementRow } from "@/modules/external/portal/portalStatement";

/** How My Bills says money — words, never Dr/Cr. Shared by the portal and the customer app. */
export const AMBER = "text-amber-700 dark:text-amber-400";
export const GREEN = "text-emerald-700 dark:text-emerald-400";

/** + is what they owe, − is an advance with us — said in words, not Dr/Cr. */
export function balanceText(n: number) {
    if (Math.abs(n) < 0.005) return formatInr(0);
    return n > 0 ? `${formatInr(n)} due` : `${formatInr(-n)} adv`;
}

export function balanceClass(n: number) {
    if (Math.abs(n) < 0.005) return "";
    return n > 0 ? AMBER : GREEN;
}

/** A bill's or payment's settlement as a chip: "Paid", "₹500 due", "₹200 unused". */
export function settlementChip(row: Pick<PortalStatementRow, "settlement" | "kind" | "open">): { text: string; tone: string } | null {
    if (row.settlement == null) return null;
    const settled = row.settlement === "SETTLED";
    const text = settled
        ? (row.kind === "payment" ? "Used" : "Paid")
        : row.kind === "payment" || row.kind === "return"
            ? `${formatInr(row.open)} unused`
            : `${formatInr(row.open)} due`;
    const tone = settled
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    return { text, tone };
}

/**
 * "Pay the whole due by UPI" — opens any UPI app pre-filled on the phone (and is
 * the QR on a computer). The shop records the receipt when the money shows in
 * the bank. Null when the shop has no UPI id set.
 */
export function upiDueLink(amountRupees: number, profileLabel: string): string | null {
    if (!COMPANY_DETAILS.bank.upiVpa) return null;
    return upiProvider.build(
        { upiVpa: COMPANY_DETAILS.bank.upiVpa, payeeName: COMPANY_DETAILS.upi.payeeName },
        { amountRupees, note: `Due ${profileLabel}`.slice(0, 50) },
    );
}
