import { formatInr } from "@/shared/lib/format/moneyInr";

/** A party balance signed their way round (+ they owe us, − we owe them), in words
 *  a salesman reads without knowing Dr / Cr. */
export function balanceLabel(balance: number): { text: string; tone: string } {
    if (Math.abs(balance) < 0.005) return { text: "Settled", tone: "text-muted-foreground" };
    return balance > 0
        ? { text: `${formatInr(balance)} to receive`, tone: "text-destructive" }
        : { text: `${formatInr(-balance)} to pay`, tone: "text-emerald-600 dark:text-emerald-400" };
}
