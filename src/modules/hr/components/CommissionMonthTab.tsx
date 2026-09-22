"use client";

// Per person — each person's overrides, and the leaderboard: under each person the heads that apply to
// them with a per-person override. Owner, 2026-09-23: *"this month tab, should
// be user wise override %, per commission head. user see only applicable to
// him and globally on."* and *"rename this month tab … in this we will set
// user override."*
//
// So a person's row opens into one line per head that reaches them: the head's
// own terms, a box to give THIS person their own rate (a share head) or their
// own bonus (a bonus head), and a switch to take the head off them. A head that
// is off globally, or not for their role, never appears — the same rule My Info
// will follow. The month's sales are real (from the board read); what they
// earn is computed here from the heads and overrides, with the real arithmetic
// (shared/lib/hr/commissionScheme.ts). UI ONLY — overrides live in state.

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { NumericInput } from "@/shared/components/NumericInput";
import UserAvatar from "@/shared/components/UserAvatar";
import { formatRupeesFromPaise, paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import { computeCommission, describeRule, formatBp, type CommissionRule } from "@/shared/lib/hr/commissionScheme";
import type { CommissionBoardRow } from "../lib/commissionTypes";
import { KIND_BADGE, KIND_SHORT, headAppliesTo, type CommissionHead } from "./CommissionHeadsTab";
import { TargetProgress } from "./MyTargetCard";

/** One person's say over one head: their own figure (rate % or bonus ₹ as typed), and whether the head is off for them. */
export interface HeadOverride {
    value: string;
    off: boolean;
}
export type Overrides = Record<string, HeadOverride>;
export const overrideKey = (userId: number, headId: number) => `${userId}:${headId}`;

/** What the override box edits for this kind of head, if anything. */
function overridable(h: CommissionHead): "rate" | "bonus" | null {
    return h.rule.kind === "PERCENT" || h.rule.kind === "ABOVE_TARGET" ? "rate" : h.rule.kind === "BONUS" ? "bonus" : null;
}

/** The head's rule as it applies to one person — their own figure in place of the head's. */
function effectiveRule(h: CommissionHead, o: HeadOverride | undefined): CommissionRule {
    if (!o || o.value.trim() === "") return h.rule;
    const what = overridable(h);
    if (what === "rate") {
        const n = Number(o.value);
        return Number.isFinite(n) && n >= 0 ? { ...h.rule, rateBp: Math.round(n * 100) } : h.rule;
    }
    if (what === "bonus") {
        const p = parseRupeesToPaise(o.value);
        return p != null ? { ...h.rule, bonusPaise: p } : h.rule;
    }
    return h.rule;
}

export default function CommissionMonthTab({ rows, heads, overrides, setOverrides, canEdit, isCurrent, monthLabel }: {
    rows: CommissionBoardRow[];
    heads: CommissionHead[];
    overrides: Overrides;
    setOverrides: (fn: (o: Overrides) => Overrides) => void;
    canEdit: boolean;
    isCurrent: boolean;
    monthLabel: string;
}) {
    const [open, setOpen] = useState<number | null>(null);

    // Each person: the heads that reach them (globally on + their role), the
    // rules after their overrides, and what the month's sales come to.
    const judged = useMemo(() => rows.map((r) => {
        const mine = heads.filter((h) => h.active && headAppliesTo(h, r.role));
        const on = mine.filter((h) => !overrides[overrideKey(r.userId, h.id)]?.off);
        const rules = on.map((h) => effectiveRule(h, overrides[overrideKey(r.userId, h.id)]));
        const outcome = rules.length ? computeCommission({ rules }, r.thisMonth.salesPaise) : null;
        return { row: r, mine, on, outcome, month: { ...r.thisMonth, outcome } };
    }).sort((a, b) => {
        const ax = a.outcome?.achieved ?? -1, bx = b.outcome?.achieved ?? -1;
        if (bx !== ax) return bx - ax;
        return b.row.thisMonth.salesPaise - a.row.thisMonth.salesPaise;
    }), [rows, heads, overrides]);

    const setOv = (userId: number, headId: number, patch: Partial<HeadOverride>) =>
        setOverrides((o) => ({ ...o, [overrideKey(userId, headId)]: { value: "", off: false, ...o[overrideKey(userId, headId)], ...patch } }));

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Open a person to see the heads that reach them and give them their own rate or bonus on any of them. A head that is off globally, or not for their role, is not listed — they will not see it on My Info either. <span className="font-medium text-foreground">Preview only: overrides are not saved yet.</span>
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">#</TableHead>
                            <TableHead>Person</TableHead>
                            <TableHead className="w-28">Heads</TableHead>
                            <TableHead className="min-w-[12rem]">{isCurrent ? "This month" : monthLabel}</TableHead>
                            <TableHead className="text-right">Earned</TableHead>
                            <TableHead className="w-10" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {judged.length === 0 && <TableEmptyRow colSpan={6} message="No current staff." />}
                        {judged.map(({ row: r, mine, on, outcome, month }, i) => {
                            const isOpen = open === r.userId;
                            return (
                                <Fragment key={r.userId}>
                                    <TableRow className={`cursor-pointer ${outcome?.targetMet ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`} onClick={() => setOpen(isOpen ? null : r.userId)}>
                                        <TableCell className="text-muted-foreground">{outcome?.targetMet ? <Trophy size={16} className="text-amber-500" /> : i + 1}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <UserAvatar avatarUrl={r.avatarUrl} name={r.name} sizePx={32} className="shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="truncate font-medium">{r.name}</div>
                                                    <div className="text-xs text-muted-foreground">{r.role ?? "no role"}{r.staffCode ? ` · ${r.staffCode}` : ""}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {mine.length === 0 ? <span className="text-muted-foreground">none</span> : `${on.length} of ${mine.length} on`}
                                        </TableCell>
                                        <TableCell><TargetProgress month={month} compact /></TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">
                                            {outcome && outcome.totalPaise > 0 ? formatRupeesFromPaise(outcome.totalPaise) : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={isOpen ? "Hide heads" : "Show heads"}>
                                                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                    {isOpen && mine.length === 0 && (
                                        <TableRow className="bg-muted/30"><TableCell /><TableCell colSpan={5} className="text-xs text-muted-foreground">No head reaches {r.name} — none is on for {r.role ?? "someone with no role"}.</TableCell></TableRow>
                                    )}
                                    {isOpen && mine.map((h) => {
                                        const o = overrides[overrideKey(r.userId, h.id)];
                                        const what = overridable(h);
                                        const rule = effectiveRule(h, o);
                                        const paid = o?.off ? 0 : (outcome?.rules.find((x) => x.rule === rule)?.paise ?? 0);
                                        const base = what === "rate" ? formatBp(h.rule.rateBp) : what === "bonus" ? formatRupeesFromPaise(h.rule.bonusPaise) : null;
                                        return (
                                            <TableRow key={h.id} className={`bg-muted/30 ${o?.off ? "opacity-60" : ""}`}>
                                                <TableCell />
                                                <TableCell className="whitespace-normal">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <span className="font-medium">{h.name}</span>
                                                        <Badge variant="outline" className={`px-1.5 text-[10px] ${KIND_BADGE[h.rule.kind]}`}>{KIND_SHORT[h.rule.kind]}</Badge>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">{describeRule(rule, formatRupeesFromPaise)}{o?.value.trim() ? ` · head says ${base}` : ""}</div>
                                                </TableCell>
                                                <TableCell colSpan={2}>
                                                    {what ? (
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <span className="text-muted-foreground">{what === "rate" ? "Own rate %" : "Own bonus ₹"}</span>
                                                            <NumericInput mode="decimal" className="h-8 w-28" disabled={!canEdit || !!o?.off} aria-label={`${r.name} ${h.name} override`}
                                                                value={o?.value ?? ""} onValueChange={(v) => setOv(r.userId, h.id, { value: v })}
                                                                placeholder={what === "rate" ? formatBp(h.rule.rateBp).replace("%", "") : String(paiseToRupees(h.rule.bonusPaise))} />
                                                            {o?.value.trim() && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOv(r.userId, h.id, { value: "" })}>use head&apos;s</Button>}
                                                        </div>
                                                    ) : <span className="text-xs text-muted-foreground">Slabs — on or off only</span>}
                                                </TableCell>
                                                <TableCell className="text-right text-sm tabular-nums">{paid > 0 ? formatRupeesFromPaise(paid) : <span className="text-muted-foreground">—</span>}</TableCell>
                                                <TableCell>
                                                    <Switch checked={!o?.off} disabled={!canEdit} aria-label={`${h.name} on for ${r.name}`} onCheckedChange={(v) => setOv(r.userId, h.id, { off: !v })} />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
