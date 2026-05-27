"use client";

// Placeholder per the Phase 4 plan. Real bank reconciliation needs:
//   1. Bank statement import (CSV/Excel) → parsed rows in a staging table
//   2. Auto-match against bank-ledger vouchers by amount + date proximity
//   3. Manual match UI for the leftovers
//   4. "Reconciled balance" report showing matched vs unmatched
// All of that is a separate project — this page just reserves the route.

import Link from "next/link";
import { Landmark, Construction, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const ROADMAP = [
    "Import bank statement (CSV / Excel)",
    "Auto-match by amount + date window",
    "Manual match UI for the leftovers",
    "Reconciled vs unmatched balance reports",
    "Cheque-deposit and post-dated cheque tracking",
];

export default function BankReconciliationPlaceholderPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-4xl mx-auto space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <Landmark size={22} /> Bank Reconciliation
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Match recorded bank-ledger vouchers against the bank&apos;s own statement and find the gaps.
                </p>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-card p-6 shadow-sm">
                <div className="flex items-start gap-3">
                    <Construction size={20} className="shrink-0 text-amber-600 mt-0.5" />
                    <div className="space-y-3">
                        <div>
                            <h2 className="font-semibold text-foreground">Coming soon</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Bank reconciliation is a sizable feature on its own — bank-statement import,
                                fuzzy auto-matching, manual review queue. We&apos;ve reserved this route so the
                                sidebar entry is in place, but the actual implementation is a separate project.
                            </p>
                        </div>

                        <ul className="space-y-1.5 text-sm">
                            {ROADMAP.map((item) => (
                                <li key={item} className="flex items-start gap-2 text-muted-foreground">
                                    <ArrowRight size={14} className="shrink-0 mt-0.5 text-amber-600" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>

                        <div className="pt-3 border-t border-border">
                            <p className="text-xs text-muted-foreground">
                                Until then, eyeball your bank balance against{" "}
                                <Link href="/office/accountancy/reports/bank-book" className="text-primary hover:underline">Bank Book</Link>{" "}
                                or drill into a specific bank ledger from there.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </ScrollArea>
    );
}
