"use client";

// My target — the motivation card. One bar to the biggest target, the rupees
// sold, the next line to cross and what it pays, and what the month has earned
// so far. Every figure comes from `commissionScheme.ts`, the same arithmetic
// payroll will run, so what the card promises is what the payslip pays.

import { Check, Target, Trophy } from "lucide-react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { describeRule } from "@/shared/lib/hr/commissionScheme";
import type { CommissionMonth } from "../lib/commissionTypes";

export const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Step a YYYY-MM string by whole months, in UTC so a timezone cannot slip a day. */
export function shiftMonth(month: string, by: number): string {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const pctOf = (m: CommissionMonth) => (m.outcome?.achieved != null ? Math.round(m.outcome.achieved * 100) : null);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * The bar and its one-line reading. `compact` is the board row; the full form
 * is the person's own card. Milestone ticks mark every targeted rule.
 */
export function TargetProgress({ month: m, compact = false }: { month: CommissionMonth; compact?: boolean }) {
    const o = m.outcome;
    const pct = pctOf(m);
    const top = o?.topTargetPaise ?? 0;
    const met = !!o?.targetMet;
    const colour = met ? "bg-emerald-500" : pct != null && pct >= 70 ? "bg-amber-500" : "bg-primary";

    if (top <= 0) {
        return (
            <div className={compact ? "text-sm" : "text-base"}>
                <span className="font-medium tabular-nums">{formatRupeesFromPaise(m.salesPaise)}</span>
                <span className="text-muted-foreground"> sold{m.billCount ? ` · ${m.billCount} bill${m.billCount === 1 ? "" : "s"}` : ""}</span>
            </div>
        );
    }
    const next = o!.nextTargetPaise;
    const short = next != null ? next - m.salesPaise : 0;
    const marks = [...new Set(o!.rules.map((r) => r.targetPaise).filter((t) => t > 0 && t < top))];
    return (
        <div className="space-y-1">
            <div className={`flex items-baseline justify-between gap-2 ${compact ? "text-xs" : "text-sm"}`}>
                <span className="tabular-nums">
                    <span className="font-medium">{formatRupeesFromPaise(m.salesPaise)}</span>
                    <span className="text-muted-foreground"> of {formatRupeesFromPaise(top)}</span>
                </span>
                <span className={`font-semibold tabular-nums ${met ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{pct}%</span>
            </div>
            <div className={`relative overflow-hidden rounded-full bg-muted ${compact ? "h-1.5" : "h-3"}`} role="progressbar" aria-valuenow={Math.min(100, pct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full transition-[width] ${colour}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                {marks.map((t) => (
                    <div key={t} className="absolute top-0 h-full w-0.5 bg-background/80" style={{ left: `${(t / top) * 100}%` }} title={formatRupeesFromPaise(t)} />
                ))}
            </div>
            {compact && (
                <div className="text-xs text-muted-foreground">
                    {met ? "Every target reached"
                        : m.daysLeft > 0 ? `${formatRupeesFromPaise(short)} to the next line · ${days(m.daysLeft)} left`
                        : `${formatRupeesFromPaise(short)} short of the next line`}
                </div>
            )}
        </div>
    );
}

export default function MyTargetCard({ month: m, isCurrentMonth }: { month: CommissionMonth; isCurrentMonth: boolean }) {
    const sold = m.salesPaise > 0
        ? <> You sold <span className="font-medium text-foreground">{formatRupeesFromPaise(m.salesPaise)}</span> in {m.billCount} bill{m.billCount === 1 ? "" : "s"}.</>
        : null;
    if (m.mode === "OFF") {
        return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Commission is switched off for you.{sold}</div>;
    }
    const scheme = m.scheme;
    if (!scheme) {
        return (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No target or commission scheme applies to you{isCurrentMonth ? " yet" : " for this month"}.{sold}
            </div>
        );
    }
    const o = m.outcome!;
    const top = o.topTargetPaise;
    const next = o.nextTargetPaise;
    const short = next != null ? next - m.salesPaise : 0;
    const perDay = m.daysLeft > 0 && short > 0 ? Math.ceil(short / m.daysLeft) : 0;
    const nextRule = next != null ? o.rules.find((r) => r.targetPaise === next) : null;
    const nextPays = nextRule
        ? nextRule.rule.kind === "BONUS" ? `${formatRupeesFromPaise(nextRule.rule.bonusPaise)} bonus` : `${describeRule(nextRule.rule, formatRupeesFromPaise)}`
        : "";

    let headline: string;
    if (top <= 0) headline = isCurrentMonth ? "Keep the bills coming — every sale earns." : "The month's sales.";
    else if (o.targetMet) headline = isCurrentMonth ? "Every target reached — every rupee from here is extra." : "Every target reached.";
    else if (m.daysLeft > 0) headline = `${formatRupeesFromPaise(short)} to go — about ${formatRupeesFromPaise(perDay)} a day for ${days(m.daysLeft)} more — and ${nextPays} is yours.`;
    else headline = `${formatRupeesFromPaise(short)} short of the next line.`;

    return (
        <div className={`rounded-lg border p-4 ${o.targetMet ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20" : "border-border bg-card"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {o.targetMet ? <Trophy size={14} className="text-amber-500" /> : <Target size={14} />}
                        <span>{top > 0 ? `Monthly target ${formatRupeesFromPaise(top)}` : "My sales"}{scheme.userId === null ? " · shop scheme" : " · my own scheme"}</span>
                    </div>
                    <div className="mt-1 text-base font-semibold">{headline}</div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-muted-foreground">Earned {isCurrentMonth ? "so far" : "this month"}</div>
                    <div className="text-2xl font-bold tabular-nums">{formatRupeesFromPaise(o.totalPaise)}</div>
                </div>
            </div>
            <div className="mt-3">
                <TargetProgress month={m} />
            </div>
            <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                {o.rules.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                        <span className="flex items-center gap-1.5">
                            {r.targetPaise > 0 && (r.targetMet
                                ? <Check size={12} className="text-emerald-600" />
                                : <span className="inline-block h-3 w-3 rounded-full border border-muted-foreground/50" />)}
                            <span className={r.targetPaise > 0 && !r.targetMet ? "text-muted-foreground" : ""}>{describeRule(r.rule, formatRupeesFromPaise)}</span>
                        </span>
                        <span className="font-medium tabular-nums">{r.paise > 0 ? formatRupeesFromPaise(r.paise) : "—"}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.billCount}</span> bill{m.billCount === 1 ? "" : "s"} counted</div>
        </div>
    );
}
