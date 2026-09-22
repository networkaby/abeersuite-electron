"use client";

// Give commission — one modal, one person, everything about their commission.
// Owner, 2026-09-23: *"the place is too inside, give a button on
// office/hr/commission and /office/hr/payroll where we give commission user
// wise (manual and auto override) modal."*
//
// Pick a person; every head that reaches them is listed. An automatic head
// (share of sales, above target, slabs, bonus) takes their own rate / bonus
// and an on/off. A manual-count head shows the month's count against its
// target, takes a new entry right here (date, how many, note) and lists the
// entries with a remove. It reads the same board payload the Targets &
// Commission page reads, so the figures cannot disagree, and every write goes
// through the same routes.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumericInput } from "@/shared/components/NumericInput";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import UserAvatar from "@/shared/components/UserAvatar";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise, paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import { describeRule, formatBp } from "@/shared/lib/hr/commissionScheme";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { toBp } from "../lib/commissionRuleDraft";
import type { AppliedHead, CommissionBoardPayload, CommissionBoardRow } from "../lib/commissionTypes";
import { KIND_BADGE, KIND_SHORT } from "./CommissionHeadsTab";
import { TargetProgress, monthLabel, shiftMonth } from "./MyTargetCard";

const overridable = (a: AppliedHead): "rate" | "bonus" | null =>
    a.rule.kind === "PERCENT" || a.rule.kind === "ABOVE_TARGET" ? "rate" : a.rule.kind === "BONUS" || a.rule.kind === "MANUAL" ? "bonus" : null;

export default function GiveCommissionDialog({ canEdit, initialUserId, onClose }: {
    canEdit: boolean;
    /** Open on this person straight away (a row's button); otherwise the first in the list. */
    initialUserId?: number;
    onClose: () => void;
}) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, error, reload } = useApiResource<CommissionBoardPayload>(`/api/hr/commission?month=${month}`);
    const [picked, setUserId] = useState<number | null>(initialUserId ?? null);
    // Nobody picked yet → the first in the list, derived rather than set in an effect.
    const userId = picked ?? data?.rows[0]?.userId ?? null;

    const isCurrent = data ? month === data.today.slice(0, 7) : true;
    const row = useMemo(() => data?.rows.find((r) => r.userId === userId) ?? null, [data, userId]);
    const byId = useMemo(() => new Map((data?.heads ?? []).map((h) => [h.id, h])), [data]);

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-x-hidden overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Give commission</DialogTitle>
                    <DialogDescription>
                        One person, every head that reaches them: their own rate or bonus, the head on or off, and entries for the counts the app cannot see.
                    </DialogDescription>
                </DialogHeader>

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={userId ? String(userId) : ""} onValueChange={(v) => setUserId(Number(v))}>
                                <SelectTrigger className="h-9 w-64 text-sm" aria-label="Person"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                                <SelectContent>
                                    {data.rows.map((r) => <SelectItem key={r.userId} value={String(r.userId)}>{r.name}{r.role ? ` · ${r.role}` : ""}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <div className="ml-auto flex items-center gap-1">
                                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={15} /></Button>
                                <span className="min-w-[8rem] text-center text-sm font-medium">{monthLabel(month)}</span>
                                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={15} /></Button>
                            </div>
                        </div>

                        {row && (
                            <>
                                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                                    <UserAvatar avatarUrl={row.avatarUrl} name={row.name} sizePx={36} className="shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium">{row.name} <span className="text-xs text-muted-foreground">{row.role ?? "no role"}{row.staffCode ? ` · ${row.staffCode}` : ""}</span></div>
                                        <TargetProgress month={row.thisMonth} compact />
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-muted-foreground">Earned</div>
                                        <div className="text-lg font-semibold tabular-nums">{formatRupeesFromPaise(row.thisMonth.outcome?.totalPaise ?? 0)}</div>
                                    </div>
                                </div>

                                {row.thisMonth.heads.length === 0 && (
                                    <p className="text-sm text-muted-foreground">No head reaches {row.name} — none is on for {row.role ?? "someone with no role"}. Create one on Set commission.</p>
                                )}
                                {row.thisMonth.heads.map((a) => (
                                    <HeadPanel key={a.headId} row={row} head={a} headSays={(() => {
                                        const h = byId.get(a.headId); const what = overridable(a);
                                        return h ? (what === "rate" ? formatBp(h.rule.rateBp) : what === "bonus" ? formatRupeesFromPaise(h.rule.bonusPaise) : "") : "";
                                    })()} canEdit={canEdit} onChanged={reload} />
                                ))}
                            </>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** One head for one person: the override, the switch, and — for a manual head — the entries. */
function HeadPanel({ row, head: a, headSays, canEdit, onChanged }: { row: CommissionBoardRow; head: AppliedHead; headSays: string; canEdit: boolean; onChanged: () => void }) {
    const what = overridable(a);
    const paid = a.off ? 0 : (row.thisMonth.outcome?.rules.find((x) => x.rule === a.rule)?.paise ?? 0);
    const own = what === "rate" ? String(Number((a.rule.rateBp / 100).toFixed(2))) : what === "bonus" ? String(paiseToRupees(a.rule.bonusPaise)) : "";
    const [draft, setDraft] = useState<string | null>(null);
    const [date, setDate] = useState(todayIso());
    const [count, setCount] = useState("1");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const saveOverride = async (patch: { rateBp?: number | null; bonusPaise?: number | null; off?: boolean }) => {
        try {
            await axios.put("/api/hr/commission/overrides", { userId: row.userId, headId: a.headId, ...patch });
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save"));
        }
    };
    const commit = (text: string) => {
        const t = text.trim();
        if (what === "rate") {
            const bp = t === "" ? null : toBp(t);
            if (bp === null && t !== "") return toast.error("The rate must be a number");
            if (bp !== null && bp > 10_000) return toast.error("A rate cannot be above 100%");
            void saveOverride({ rateBp: bp });
        } else if (what === "bonus") {
            const p = t === "" ? null : parseRupeesToPaise(t);
            if (p === null && t !== "") return toast.error("The bonus is not a rupee figure");
            void saveOverride({ bonusPaise: p });
        }
    };
    const addEntry = async () => {
        const n = Number(count);
        if (!Number.isInteger(n) || n < 1) return toast.error("How many — a whole number, at least 1");
        setSaving(true);
        try {
            await axios.post("/api/hr/commission/entries", { userId: row.userId, headId: a.headId, date, count: n, note: note.trim() || null });
            toast.success("Entry added");
            setCount("1"); setNote("");
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the entry"));
        } finally {
            setSaving(false);
        }
    };
    const removeEntry = async (e: { id: number; count: number; date: string }) => {
        const ok = await confirmAction({ title: `Remove ${e.count} ${a.rule.unit ?? ""} on ${formatDate(e.date)}?`, body: "A month already paid keeps what payroll froze.", confirmLabel: "Remove entry" });
        if (!ok) return;
        try {
            await axios.delete(`/api/hr/commission/entries/${e.id}`);
            onChanged();
        } catch (err) {
            toast.error(extractApiError(err, "Could not remove the entry"));
        }
    };

    return (
        <div className={`rounded-lg border border-border p-3 ${a.off ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{a.name}</span>
                        <Badge variant="outline" className={`px-1.5 text-[10px] ${KIND_BADGE[a.rule.kind]}`}>{KIND_SHORT[a.rule.kind]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{describeRule(a.rule, formatRupeesFromPaise)}{a.overridden ? ` · head says ${headSays}` : ""}</div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{paid > 0 ? formatRupeesFromPaise(paid) : <span className="text-muted-foreground">—</span>}</span>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch checked={!a.off} disabled={!canEdit} aria-label={`${a.name} on for ${row.name}`} onCheckedChange={(v) => saveOverride({ off: !v })} /> on
                    </label>
                </div>
            </div>

            {what && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{what === "rate" ? "Own rate %" : "Own bonus ₹"}</span>
                    <NumericInput mode="decimal" className="h-8 w-28" disabled={!canEdit || a.off} aria-label={`${a.name} override`}
                        value={draft ?? (a.overridden ? own : "")} onValueChange={setDraft}
                        onBlur={() => { if (draft !== null) { commit(draft); setDraft(null); } }}
                        placeholder={headSays.replace("%", "").replace("₹", "")} />
                    {a.overridden && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => commit("")}>use head&apos;s</Button>}
                </div>
            )}

            {a.rule.kind === "MANUAL" && (
                <div className="mt-2 space-y-2 text-xs">
                    <div className="font-medium tabular-nums">{a.rule.count ?? 0}{a.rule.targetCount ? ` of ${a.rule.targetCount}` : ""} {a.rule.unit} this month</div>
                    {canEdit && !a.off && (
                        <div className="grid grid-cols-[8rem_5rem_1fr_auto] items-center gap-2">
                            <TallyDateInput value={date} onValueChange={setDate} maxIso={todayIso()} aria-label="Entry date" />
                            <NumericInput mode="digits" value={count} onValueChange={setCount} min={1} aria-label="How many" />
                            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className="h-9" />
                            <Button type="button" size="sm" disabled={saving} onClick={addEntry}><Plus size={14} /> Add</Button>
                        </div>
                    )}
                    {(a.entries ?? []).map((e) => (
                        <div key={e.id} className="flex items-center gap-2 text-muted-foreground">
                            <span className="tabular-nums">{formatDate(e.date)}</span>
                            <span className="font-medium text-foreground">{e.count}</span>
                            {e.note && <span className="truncate">— {e.note}</span>}
                            {canEdit && <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove entry" onClick={() => removeEntry(e)}><Trash2 size={12} /></button>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
