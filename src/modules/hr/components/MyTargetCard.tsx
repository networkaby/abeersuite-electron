"use client";

// My target — the motivation card. One bar, the rupees sold, the rupees still
// to go, and what the month has earned so far. Every figure comes from
// `commissionScheme.ts`, the same arithmetic payroll will run, so what the card
// promises is what the payslip pays.

import { Target, Trophy } from "lucide-react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { describeScheme } from "@/shared/lib/hr/commissionScheme";
import type { CommissionMonth } from "../lib/commissionTypes";

export const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Step a YYYY-MM string by whole months, in UTC so a timezone cannot slip a day. */
export function shiftMonth(month: string, by: number): string {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const pctOf = (m: CommissionMonth) => (m.outcome?.achieved != null ? Math.round(m.outcome.achieved * 100) : null);

/**
 * The bar and its one-line reading. `compact` is the board row; the full form
 * is the person's own card.
 */
export function TargetProgress({ month: m, compact = false }: { month: CommissionMonth; compact?: boolean }) {
    const pct = pctOf(m);
    const target = m.scheme?.targetPaise ?? 0;
    const met = !!m.outcome?.targetMet;
    const colour = met ? "bg-emerald-500" : pct != null && pct >= 70 ? "bg-amber-500" : "bg-primary";

    if (target <= 0) {
        return (
            <div className={compact ? "text-sm" : "text-base"}>
                <span className="font-medium tabular-nums">{formatRupeesFromPaise(m.salesPaise)}</span>
                <span className="text-muted-foreground"> sold{m.billCount ? ` · ${m.billCount} bill${m.billCount === 1 ? "" : "s"}` : ""}</span>
            </div>
        );
    }
    return (
        <div className="space-y-1">
            <div className={`flex items-baseline justify-between gap-2 ${compact ? "text-xs" : "text-sm"}`}>
                <span className="tabular-nums">
                    <span className="font-medium">{formatRupeesFromPaise(m.salesPaise)}</span>
                    <span className="text-muted-foreground"> of {formatRupeesFromPaise(target)}</span>
                </span>
                <span className={`font-semibold tabular-nums ${met ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{pct}%</span>
            </div>
            <div className={`overflow-hidden rounded-full bg-muted ${compact ? "h-1.5" : "h-3"}`} role="progressbar" aria-valuenow={Math.min(100, pct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full transition-[width] ${colour}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            </div>
            {compact && (
                <div className="text-xs text-muted-foreground">
                    {met ? "Target reached" : m.daysLeft > 0 ? `${formatRupeesFromPaise(m.shortPaise)} to go · ${m.daysLeft} day${m.daysLeft === 1 ? "" : "s"} left` : `${formatRupeesFromPaise(m.shortPaise)} short`}
                </div>
            )}
        </div>
    );
}

export default function MyTargetCard({ month: m, isCurrentMonth }: { month: CommissionMonth; isCurrentMonth: boolean }) {
    const scheme = m.scheme;
    if (!scheme) {
        return (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No target or commission scheme is set for you{isCurrentMonth ? " yet" : " for this month"}.
                {m.salesPaise > 0 && <> You sold <span className="font-medium text-foreground">{formatRupeesFromPaise(m.salesPaise)}</span> in {m.billCount} bill{m.billCount === 1 ? "" : "s"}.</>}
            </div>
        );
    }
    const o = m.outcome!;
    const target = scheme.targetPaise;
    const perDay = m.daysLeft > 0 && m.shortPaise > 0 ? Math.ceil(m.shortPaise / m.daysLeft) : 0;

    let headline: string;
    if (o.targetMet) headline = isCurrentMonth ? "Target reached — every rupee from here is extra." : "Target reached.";
    else if (target <= 0) headline = isCurrentMonth ? "Keep the bills coming." : "The month's sales.";
    else if (m.daysLeft > 0) headline = `${formatRupeesFromPaise(m.shortPaise)} to go — about ${formatRupeesFromPaise(perDay)} a day for ${m.daysLeft} more working day${m.daysLeft === 1 ? "" : "s"}.`;
    else headline = `${formatRupeesFromPaise(m.shortPaise)} short of the target.`;

    return (
        <div className={`rounded-lg border p-4 ${o.targetMet ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20" : "border-border bg-card"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {o.targetMet ? <Trophy size={14} className="text-amber-500" /> : <Target size={14} />}
                        <span>{target > 0 ? `Monthly target ${formatRupeesFromPaise(target)}` : "My sales"}</span>
                    </div>
                    <div className="mt-1 text-base font-semibold">{headline}</div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-muted-foreground">Earned {isCurrentMonth ? "so far" : "this month"}</div>
                    <div className="text-2xl font-bold tabular-nums">{formatRupeesFromPaise(o.totalPaise)}</div>
                    {o.bonusPaise > 0 && <div className="text-xs text-emerald-600 dark:text-emerald-400">incl. {formatRupeesFromPaise(o.bonusPaise)} bonus</div>}
                </div>
            </div>
            <div className="mt-3">
                <TargetProgress month={m} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div><span className="font-medium text-foreground">{m.billCount}</span> bill{m.billCount === 1 ? "" : "s"} counted</div>
                <div>Scheme: <span className="text-foreground">{describeScheme(scheme, formatRupeesFromPaise)}</span></div>
                {scheme.bonusPaise > 0 && !o.targetMet && target > 0 && (
                    <div>Reach the target and a <span className="font-medium text-foreground">{formatRupeesFromPaise(scheme.bonusPaise)}</span> bonus is yours.</div>
                )}
            </div>
        </div>
    );
}
