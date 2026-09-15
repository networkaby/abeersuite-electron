"use client";

import { formatDrCr } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";

/** The money chip on a party list row.
 *
 *  `balance`/`normalBalance` are null ONLY on a `fromCache` placeholder row —
 *  the cache carries identity, never money — and that renders as pending rather
 *  than as a figure. A live row always has both.
 *
 *  Nothing outstanding stays quiet grey; an amount still sitting on the party's
 *  account reads amber, so the handful of rows that need chasing stand out of a
 *  mostly-zero list. A balance the other way round keeps the red it always had. */
export function PartyBalanceChip({ balance, normalBalance }: {
    balance: number | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
}) {
    if (balance === null || normalBalance === null) {
        return (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                ···
            </span>
        );
    }

    return (
        <span
            className={cn(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                balance === 0
                    ? "bg-muted text-muted-foreground"
                    : balance < 0
                        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
            )}
        >
            {formatDrCr(balance, normalBalance)}
        </span>
    );
}
