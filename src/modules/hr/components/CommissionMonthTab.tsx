"use client";

// Per person — each person's overrides, and the leaderboard. Owner, 2026-09-23:
// *"user wise override %, per commission head. user see only applicable to him
// and globally on"* — *"rename this month tab … in this we will set user
// override."*
//
// A person's row opens into one line per head that reaches them: the head's
// terms as they apply to this person, a box to give THEM their own rate (a
// share head) or bonus (a bonus head), and a switch to take the head off them.
// A head that is off globally, or not for their role, never appears — the very
// rule My Info follows. The sales and the earned figure come from the board
// read, computed server side with the real arithmetic; an override is saved
// through /api/hr/commission/overrides and the board re-reads.

import { Fragment, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/shared/components/Field";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { NumericInput } from "@/shared/components/NumericInput";
import UserAvatar from "@/shared/components/UserAvatar";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatRupeesFromPaise, paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import { describeRule, formatBp } from "@/shared/lib/hr/commissionScheme";
import { toBp } from "../lib/commissionRuleDraft";
import type { AppliedHead, CommissionBoardRow, CommissionHeadDto } from "../lib/commissionTypes";
import { KIND_BADGE, KIND_SHORT } from "./CommissionHeadsTab";
import { TargetProgress } from "./MyTargetCard";

/** What the override box edits for this kind of head, if anything. */
const overridable = (a: AppliedHead): "rate" | "bonus" | null =>
    a.rule.kind === "PERCENT" || a.rule.kind === "ABOVE_TARGET" ? "rate" : a.rule.kind === "BONUS" || a.rule.kind === "MANUAL" ? "bonus" : null;

export default function CommissionMonthTab({ rows, heads, canEdit, isCurrent, monthLabel, onChanged }: {
    rows: CommissionBoardRow[];
    heads: CommissionHeadDto[];
    canEdit: boolean;
    isCurrent: boolean;
    monthLabel: string;
    onChanged: () => void;
}) {
    const [open, setOpen] = useState<number | null>(null);
    // The box as typed, per person+head, until it is saved on blur.
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [adding, setAdding] = useState<{ row: CommissionBoardRow; head: AppliedHead } | null>(null);

    const removeEntry = async (e: { id: number; count: number; date: string }, head: AppliedHead) => {
        const ok = await confirmAction({ title: `Remove ${e.count} ${head.rule.unit ?? ""} on ${formatDate(e.date)}?`.replace("  ", " "), body: "A month already paid keeps what payroll froze.", confirmLabel: "Remove entry" });
        if (!ok) return;
        try {
            await axios.delete(`/api/hr/commission/entries/${e.id}`);
            onChanged();
        } catch (err) {
            toast.error(extractApiError(err, "Could not remove the entry"));
        }
    };
    const byId = new Map(heads.map((h) => [h.id, h]));

    // Achievers first, by share of target; then by sales — the board reads as
    // a leaderboard, which is the point of putting it on a wall.
    const ranked = [...rows].sort((a, b) => {
        const ax = a.thisMonth.outcome?.achieved ?? -1, bx = b.thisMonth.outcome?.achieved ?? -1;
        if (bx !== ax) return bx - ax;
        return b.thisMonth.salesPaise - a.thisMonth.salesPaise;
    });

    const save = async (userId: number, headId: number, patch: { rateBp?: number | null; bonusPaise?: number | null; off?: boolean }) => {
        try {
            await axios.put("/api/hr/commission/overrides", { userId, headId, ...patch });
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the override"));
        }
    };

    /** The typed figure → the override, or null when blank (back to the head's). */
    const commit = (r: CommissionBoardRow, a: AppliedHead, what: "rate" | "bonus", text: string) => {
        const t = text.trim();
        if (what === "rate") {
            const bp = t === "" ? null : toBp(t);
            if (bp === null && t !== "") return toast.error("The rate must be a number");
            if (bp !== null && bp > 10_000) return toast.error("A rate cannot be above 100%");
            void save(r.userId, a.headId, { rateBp: bp });
        } else {
            const p = t === "" ? null : parseRupeesToPaise(t);
            if (p === null && t !== "") return toast.error("The bonus is not a rupee figure");
            void save(r.userId, a.headId, { bonusPaise: p });
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Open a person to see the heads that reach them and give them their own rate or bonus on any of them. A head that is off globally, or not for their role, is not listed — they will not see it on My Info either.
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
                        {ranked.length === 0 && <TableEmptyRow colSpan={6} message="No current staff." />}
                        {ranked.map((r, i) => {
                            const m = r.thisMonth;
                            const on = m.heads.filter((a) => !a.off);
                            const isOpen = open === r.userId;
                            return (
                                <Fragment key={r.userId}>
                                    <TableRow className={`cursor-pointer ${m.outcome?.targetMet ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`} onClick={() => setOpen(isOpen ? null : r.userId)}>
                                        <TableCell className="text-muted-foreground">{m.outcome?.targetMet ? <Trophy size={16} className="text-amber-500" /> : i + 1}</TableCell>
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
                                            {m.heads.length === 0 ? <span className="text-muted-foreground">none</span> : `${on.length} of ${m.heads.length} on`}
                                        </TableCell>
                                        <TableCell><TargetProgress month={m} compact /></TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">
                                            {m.outcome && m.outcome.totalPaise > 0 ? formatRupeesFromPaise(m.outcome.totalPaise) : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={isOpen ? "Hide heads" : "Show heads"}>
                                                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                    {isOpen && m.heads.length === 0 && (
                                        <TableRow className="bg-muted/30"><TableCell /><TableCell colSpan={5} className="text-xs text-muted-foreground">No head reaches {r.name} — none is on for {r.role ?? "someone with no role"}.</TableCell></TableRow>
                                    )}
                                    {isOpen && m.heads.map((a) => {
                                        const head = byId.get(a.headId);
                                        const what = overridable(a);
                                        const key = `${r.userId}:${a.headId}`;
                                        const paid = a.off ? 0 : (m.outcome?.rules.find((x) => x.rule === a.rule)?.paise ?? 0);
                                        const own = what === "rate" ? String(Number((a.rule.rateBp / 100).toFixed(2))) : what === "bonus" ? String(paiseToRupees(a.rule.bonusPaise)) : "";
                                        const headSays = head ? (what === "rate" ? formatBp(head.rule.rateBp) : what === "bonus" ? formatRupeesFromPaise(head.rule.bonusPaise) : "") : "";
                                        return (
                                            <TableRow key={a.headId} className={`bg-muted/30 ${a.off ? "opacity-60" : ""}`}>
                                                <TableCell />
                                                <TableCell className="whitespace-normal">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <span className="font-medium">{a.name}</span>
                                                        <Badge variant="outline" className={`px-1.5 text-[10px] ${KIND_BADGE[a.rule.kind]}`}>{KIND_SHORT[a.rule.kind]}</Badge>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">{describeRule(a.rule, formatRupeesFromPaise)}{a.overridden ? ` · head says ${headSays}` : ""}</div>
                                                    {a.rule.kind === "MANUAL" && (
                                                        <div className="mt-1 space-y-0.5 text-xs">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium tabular-nums">{a.rule.count ?? 0}{a.rule.targetCount ? ` of ${a.rule.targetCount}` : ""} {a.rule.unit}</span>
                                                                {canEdit && !a.off && (
                                                                    <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={(ev) => { ev.stopPropagation(); setAdding({ row: r, head: a }); }}>
                                                                        <Plus size={12} /> Add entry
                                                                    </Button>
                                                                )}
                                                            </div>
                                                            {(a.entries ?? []).map((e) => (
                                                                <div key={e.id} className="flex items-center gap-2 text-muted-foreground">
                                                                    <span className="tabular-nums">{formatDate(e.date)}</span>
                                                                    <span className="font-medium text-foreground">{e.count}</span>
                                                                    {e.note && <span className="truncate">— {e.note}</span>}
                                                                    {canEdit && <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove entry" onClick={() => removeEntry(e, a)}><Trash2 size={12} /></button>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell colSpan={2}>
                                                    {what ? (
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <span className="text-muted-foreground">{what === "rate" ? "Own rate %" : "Own bonus ₹"}</span>
                                                            <NumericInput mode="decimal" className="h-8 w-28" disabled={!canEdit || a.off} aria-label={`${r.name} ${a.name} override`}
                                                                value={drafts[key] ?? (a.overridden ? own : "")}
                                                                onValueChange={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
                                                                onBlur={() => { if (drafts[key] !== undefined) { commit(r, a, what, drafts[key]); setDrafts((d) => { const n = { ...d }; delete n[key]; return n; }); } }}
                                                                placeholder={headSays.replace("%", "").replace("₹", "")} />
                                                            {a.overridden && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => commit(r, a, what, "")}>use head&apos;s</Button>}
                                                        </div>
                                                    ) : <span className="text-xs text-muted-foreground">Slabs — on or off only</span>}
                                                </TableCell>
                                                <TableCell className="text-right text-sm tabular-nums">{paid > 0 ? formatRupeesFromPaise(paid) : <span className="text-muted-foreground">—</span>}</TableCell>
                                                <TableCell>
                                                    <Switch checked={!a.off} disabled={!canEdit} aria-label={`${a.name} on for ${r.name}`} onCheckedChange={(v) => save(r.userId, a.headId, { off: !v })} />
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
            {adding && (
                <EntryDialog row={adding.row} head={adding.head} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); onChanged(); }} />
            )}
        </div>
    );
}

/** One thing done outside the app: the day, how many, a note. */
function EntryDialog({ row, head, onClose, onSaved }: { row: CommissionBoardRow; head: AppliedHead; onClose: () => void; onSaved: () => void }) {
    const [date, setDate] = useState(todayIso());
    const [count, setCount] = useState("1");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const n = Number(count);
    const canSave = !saving && !!date && Number.isInteger(n) && n >= 1;
    const submit = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/commission/entries", { userId: row.userId, headId: head.headId, date, count: n, note: note.trim() || null });
            toast.success("Entry added");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the entry"));
        } finally {
            setSaving(false);
        }
    };
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{head.name} — {row.name}</DialogTitle>
                    <DialogDescription>Counted in {head.rule.unit}. It lands in the month of its date.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Date" required>{(id) => <TallyDateInput id={id} value={date} onValueChange={setDate} maxIso={todayIso()} />}</Field>
                    <Field label={`How many ${head.rule.unit ?? ""}`.trim()} required>{(id) => <NumericInput id={id} mode="digits" value={count} onValueChange={setCount} min={1} />}</Field>
                    <Field label="Note" className="sm:col-span-2">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Who, what, where (optional)" />}</Field>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={submit} disabled={!canSave}>{saving ? "Saving…" : "Add entry"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
