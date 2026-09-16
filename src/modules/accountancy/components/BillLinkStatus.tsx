"use client";

// The Status cell of an open-bill row — "Within 12d" / "Overdue 138d" — and the
// way into that bill's bill-wise links.
//
// Three screens show the very same cell: Receivables, Payables, and a party's
// own Outstanding tab. Clicking it opens the link popup for THAT bill, which is
// what the customer's Transactions tab has always done from its Settled/Partial
// /Due chip. The two are the same act read from opposite ends — there the money
// looks for its bills, here the bill looks for its money.
//
// Only the words and the click live here. Each screen still hosts the popup
// itself, because what to do after a save is its own business: one re-reads a
// whole report, the other drops one party's cache.

import { Link2 } from "lucide-react";
import { ageingStatusClass, ageingStatusLabel } from "@/modules/accountancy/lib/ageing";
import type { OutstandingBill } from "@/modules/accountancy/lib/outstandings";

export function BillLinkStatus({ bill, onLink }: {
    bill:   Pick<OutstandingBill, "bucket" | "daysOverdue" | "side" | "universalVoucherId">;
    /** Open the bill-wise popup for this bill's spine id. */
    onLink: (universalVoucherId: number) => void;
}) {
    const label = ageingStatusLabel(bill.daysOverdue);
    const tone  = `text-xs font-medium ${ageingStatusClass(bill.bucket)}`;

    // Pre-spine rows carry no id a link can point at, so they stay plain words
    // rather than offering a click that could only fail.
    if (bill.universalVoucherId === null) return <span className={tone}>{label}</span>;

    return (
        <button
            type="button"
            title={bill.side === 1
                ? "Link this bill to money already received — tick, part-amount or Auto"
                : "Link this bill to money already paid — tick, part-amount or Auto"}
            onClick={() => onLink(bill.universalVoucherId!)}
            className={`${tone} inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted`}
        >
            {label}
            <Link2 size={11} className="opacity-70" />
        </button>
    );
}
