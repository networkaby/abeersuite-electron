"use client";

// The bill-wise chip — "Settled" / "Partial ₹17,300.00" / "Due" — and the way
// into that voucher's bill-wise link popup.
//
// It answers a different question from the lifecycle badge next to it. Draft /
// Posted / Cancelled is what the voucher IS. This is what its money has been
// pointed AT: whether a receipt has been matched to it, bill by bill. A party
// can be square on the ledger and still have every bill sitting unmatched.
//
// Three families of screen show the very same chip now: a party's Transactions
// tab, the Day Book, and every voucher register. Only the words and the click
// live here — each screen still hosts the popup itself, because what to do
// after a save is its own business (one drops a party's cache, another reloads
// a page of the Day Book).
//
// Its sibling `BillLinkStatus` shows the same act read from the other end — on
// an OPEN BILL row, where the interesting word is how overdue it is rather than
// how much of it is matched.

import { Link2, Unlink } from "lucide-react";
import type { SettlementState } from "@/modules/accountancy/lib/billLink";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";

const STYLES: Record<SettlementState, { label: string; className: string }> = {
    SETTLED: { label: "Settled", className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    PARTIAL: { label: "Partial", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    DUE:     { label: "Due",     className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

// `whitespace-nowrap` — "Partial ₹17,300.00" is one fact and must not break
// across two lines in a narrow register column.
const CHIP = "inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium";

export function SettlementChip({ state, open, onLink, onUnlink }: {
    /** Null where there is nothing to settle — no party, or a documentary
     *  voucher that posts no money. Renders a plain dash. */
    state:  SettlementState | null;
    /** What is still unmatched on this voucher, in RUPEES. */
    open:   number;
    /** Open the bill-wise popup. Omitted where the row cannot be linked — a
     *  bill taken in full at the counter has nothing to point at a receipt. */
    onLink?: () => void;
    /** Open the Remove link popup. Reached by right-click on a Settled or
     *  Partial chip, and by plain click on a Settled one (nothing to link). */
    onUnlink?: () => void;
}) {
    if (!state) return <span className="text-xs opacity-40">—</span>;

    const style = STYLES[state];
    // Only a partly matched row needs its figure spelled out. On a fully due row
    // the open amount IS the total already sitting in the same line, and on a
    // settled one there is nothing left to say.
    const label = state === "PARTIAL"
        ? `${style.label} ${formatRupeesFromPaise(Math.round(open * 100))}`
        : style.label;

    const unlink = state !== "DUE" ? onUnlink : undefined;
    const onContextMenu = unlink
        ? (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); unlink(); }
        : undefined;
    const click = state === "SETTLED" ? unlink : onLink ?? undefined;

    if (!click) return <span className={`${CHIP} ${style.className}`} onContextMenu={onContextMenu}>{label}</span>;

    return (
        <button
            type="button"
            title={state === "SETTLED"
                ? "Settled — click to remove a link"
                : unlink ? "Match this bill by bill · right-click to remove a link" : "Match this against the other side, bill by bill"}
            onClick={(e) => { e.stopPropagation(); click(); }}
            onContextMenu={onContextMenu}
            className={`${CHIP} ${style.className} cursor-pointer transition-opacity hover:opacity-80`}
        >
            {label}
            {state === "SETTLED" ? <Unlink size={11} className="opacity-70" /> : <Link2 size={11} className="opacity-70" />}
        </button>
    );
}
