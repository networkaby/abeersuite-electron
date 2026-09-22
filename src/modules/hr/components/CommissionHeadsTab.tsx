"use client";

// Set commission — the catalogue of commission / target HEADS, the way the
// coupons page is a catalogue of offers. Owner, 2026-09-22/23: *"in set
// commission page is like coupon page here we create different commission or
// target head its not user specific"* — *"user kind applicable"*.
//
// A head is one named way of earning: "1% on every sale", "₹1,500 at ₹1 lakh",
// a slab ladder — globally on or off, for every role or a few. Heads are made
// here once; the Per person tab shows each person the heads that reach their
// role, with their own override. Reads come with the board; writes go to
// /api/hr/commission/heads. The arithmetic the form previews is the real one
// (shared/lib/hr/commissionScheme.ts).

import { useMemo, useState, type ReactNode } from "react";
import axios from "axios";
import { toast } from "sonner";
import { List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/shared/components/Field";
import { NumericInput } from "@/shared/components/NumericInput";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { COMMISSION_KINDS, COMMISSION_KIND_LABELS, computeCommission, describeRule, type CommissionKind } from "@/shared/lib/hr/commissionScheme";
import { blankRule, parseRule, toDraft, type RuleDraft } from "../lib/commissionRuleDraft";
import type { CommissionHeadDto } from "../lib/commissionTypes";

export const KIND_BADGE: Record<CommissionKind, string> = {
    PERCENT:      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300",
    ABOVE_TARGET: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300",
    SLABS:        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
    BONUS:        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
};
export const KIND_SHORT: Record<CommissionKind, string> = { PERCENT: "Share of sales", ABOVE_TARGET: "Above target", SLABS: "Slabs", BONUS: "Target bonus" };

const L = 100_000_00;

/** The body a create or edit sends — the terms flat, the way the API wants them. */
type HeadBody = { name: string; description: string | null; kind: CommissionKind; targetPaise: number; rateBp: number; slabs: { fromPaise: number; rateBp: number }[]; bonusPaise: number; active: boolean; appliesTo: string[] };

export default function CommissionHeadsTab({ heads, roles, canEdit, onChanged }: {
    heads: CommissionHeadDto[];
    /** Every role label the current staff carry — the "user kinds" a head can be limited to. */
    roles: string[];
    canEdit: boolean;
    onChanged: () => void;
}) {
    const [view, setView] = useState<"LIST" | "CREATE">("LIST");
    const [editing, setEditing] = useState<CommissionHeadDto | null>(null);
    const [search, setSearch] = useState("");
    const [kindFilter, setKindFilter] = useState<"ALL" | CommissionKind>("ALL");

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return heads.filter((h) => (kindFilter === "ALL" || h.rule.kind === kindFilter) && (!q || h.name.toLowerCase().includes(q) || (h.description ?? "").toLowerCase().includes(q)));
    }, [heads, search, kindFilter]);

    const openCreate = () => { setEditing(null); setView("CREATE"); };
    const openEdit = (h: CommissionHeadDto) => { setEditing(h); setView("CREATE"); };

    const save = async (body: HeadBody) => {
        try {
            if (editing) await axios.patch(`/api/hr/commission/heads/${editing.id}`, body);
            else await axios.post("/api/hr/commission/heads", body);
            toast.success(editing ? "Head saved" : "Head created");
            setEditing(null);
            setView("LIST");
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the head"));
        }
    };
    const toggle = async (h: CommissionHeadDto, active: boolean) => {
        try {
            await axios.patch(`/api/hr/commission/heads/${h.id}`, { active });
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not change the head"));
        }
    };
    const remove = async (h: CommissionHeadDto) => {
        const ok = await confirmAction({
            title: `Delete "${h.name}"?`,
            body: "Every person's override on it goes too. Months already paid keep what payroll froze.",
            confirmLabel: "Delete head",
        });
        if (!ok) return;
        try {
            await axios.delete(`/api/hr/commission/heads/${h.id}`);
            toast.success("Head deleted");
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the head"));
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                    <HeaderTab active={view === "LIST"} onClick={() => setView("LIST")} icon={<List size={14} />}>See heads</HeaderTab>
                    {canEdit && <HeaderTab active={view === "CREATE"} onClick={openCreate} icon={<Plus size={14} />}>{editing && view === "CREATE" ? "Edit head" : "Create head"}</HeaderTab>}
                </div>
                {view === "LIST" && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-64">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search heads…" className="h-9 pl-8" />
                        </div>
                        <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as "ALL" | CommissionKind)}>
                            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All kinds</SelectItem>
                                {COMMISSION_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_SHORT[k]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            <p className="text-xs text-muted-foreground">
                A head is one way of earning — a share of sales, a bonus at a target, a slab ladder. Create the heads here once and say which kinds of user they are for; each person&apos;s own overrides live on the Per person tab.
            </p>

            {view === "CREATE" ? (
                <HeadForm key={editing?.id ?? "new"} initial={editing} roles={roles} onCancel={() => { setEditing(null); setView("LIST"); }} onSave={save} />
            ) : shown.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                    {heads.length ? "No head matches." : "No heads yet — create the first one."}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                    <Table>
                        <TableHeader className="bg-muted [&_th]:bg-muted">
                            <TableRow className="hover:bg-transparent">
                                <TableHead>Head</TableHead>
                                <TableHead className="w-32">Kind</TableHead>
                                <TableHead>Terms</TableHead>
                                <TableHead className="w-40">Applies to</TableHead>
                                <TableHead className="w-20">Active</TableHead>
                                <TableHead className="w-24 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shown.map((h) => (
                                <TableRow key={h.id} className={h.active ? undefined : "opacity-60"}>
                                    <TableCell className="min-w-0">
                                        <div className="font-semibold">{h.name}</div>
                                        {h.description && <div className="text-xs text-muted-foreground">{h.description}</div>}
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className={`px-1.5 text-[10px] ${KIND_BADGE[h.rule.kind]}`}>{KIND_SHORT[h.rule.kind]}</Badge></TableCell>
                                    <TableCell className="whitespace-normal text-sm">{describeRule(h.rule, formatRupeesFromPaise)}</TableCell>
                                    <TableCell className="whitespace-normal text-xs">
                                        {h.appliesTo.length === 0 ? <span className="text-muted-foreground">Everyone</span>
                                            : <div className="flex flex-wrap gap-1">{h.appliesTo.map((r) => <Badge key={r} variant="outline" className="px-1.5 text-[10px]">{r}</Badge>)}</div>}
                                    </TableCell>
                                    <TableCell>
                                        <Switch checked={h.active} disabled={!canEdit} aria-label={`${h.name} active`} onCheckedChange={(v) => toggle(h, v)} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {canEdit && (
                                            <div className="flex justify-end gap-0.5">
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit head" onClick={() => openEdit(h)}><Pencil size={14} /></Button>
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete head" onClick={() => remove(h)}><Trash2 size={14} /></Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

/** The full-width editor for one head — name, kind, the kind's own boxes, who it is for, and the sentence it comes to. */
function HeadForm({ initial, roles, onCancel, onSave }: { initial: CommissionHeadDto | null; roles: string[]; onCancel: () => void; onSave: (h: HeadBody) => Promise<void> }) {
    const [name, setName] = useState(initial?.name ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    const [active, setActive] = useState(initial?.active ?? true);
    const [appliesTo, setAppliesTo] = useState<string[]>(initial?.appliesTo ?? []);
    const [draft, setDraft] = useState<RuleDraft>(() => (initial ? toDraft(initial.rule) : blankRule()));
    const [saving, setSaving] = useState(false);
    const { rule, bad } = useMemo(() => parseRule(draft), [draft]);
    const canSave = !bad && name.trim().length > 0 && !saving;
    const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
    const setSlab = (k: number, patch: Partial<RuleDraft["slabs"][number]>) => setDraft((d) => ({ ...d, slabs: d.slabs.map((s, l) => (l === k ? { ...s, ...patch } : s)) }));
    const toggleRole = (r: string) => setAppliesTo((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
    // A role from an earlier save that nobody carries today still shows, so it can be unticked.
    const roleChips = useMemo(() => [...new Set([...roles, ...appliesTo])].sort(), [roles, appliesTo]);

    // The example: for a slab ladder, a month landing on each line and one past
    // the last; otherwise at the target and a fifth past it, or a round lakh.
    const example = useMemo(() => {
        let points: number[];
        if (rule.kind === "SLABS" && rule.slabs.length) {
            const lines = rule.slabs.map((s) => s.fromPaise).filter((f) => f > 0);
            const last = lines[lines.length - 1] ?? 0;
            points = [...lines, last > 0 ? last * 2 : L];
        } else {
            const base = rule.targetPaise > 0 ? rule.targetPaise : L;
            points = [base, Math.round(base * 1.2)];
        }
        return points.map((sales) => ({ sales, paise: computeCommission({ rules: [rule] }, sales).totalPaise }));
    }, [rule]);

    const submit = async () => {
        setSaving(true);
        try {
            await onSave({ name: name.trim(), description: description.trim() || null, ...rule, active, appliesTo });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Head name" required>
                            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Monthly target bonus" />}
                        </Field>
                        <Field label="Kind">
                            {(id) => (
                                <Select value={draft.kind} onValueChange={(v) => set({ kind: v as CommissionKind })}>
                                    <SelectTrigger id={id} className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>{COMMISSION_KINDS.map((k) => <SelectItem key={k} value={k}>{COMMISSION_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                                </Select>
                            )}
                        </Field>
                        {(draft.kind === "ABOVE_TARGET" || draft.kind === "BONUS") && (
                            <Field label="Monthly target (₹)" required>
                                {(id) => <NumericInput id={id} mode="decimal" value={draft.target} onValueChange={(v) => set({ target: v })} placeholder="e.g. 1,00,000" />}
                            </Field>
                        )}
                        {(draft.kind === "PERCENT" || draft.kind === "ABOVE_TARGET") && (
                            <Field label="Rate (%)" required hint={draft.kind === "PERCENT" ? "On every rupee sold — a person may be given their own rate on the Per person tab" : "Only on the rupees past the target"}>
                                {(id) => <NumericInput id={id} mode="decimal" value={draft.rate} onValueChange={(v) => set({ rate: v })} placeholder="e.g. 1.5" />}
                            </Field>
                        )}
                        {draft.kind === "BONUS" && (
                            <Field label="Bonus (₹)" required hint="A flat amount the month the target is met">
                                {(id) => <NumericInput id={id} mode="decimal" value={draft.bonus} onValueChange={(v) => set({ bonus: v })} placeholder="e.g. 1,500" />}
                            </Field>
                        )}
                    </div>
                    {draft.kind === "SLABS" && (
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                                The ladder starts at ₹0. Each row is a line where the rate changes. The month&apos;s total sales land in one slab, and that slab&apos;s rate is paid on the whole amount — a direct match, nothing summed across slabs.
                            </div>
                            <div className="grid max-w-md grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground"><span>Sales from (₹)</span><span>Rate on the whole amount (%)</span><span /></div>
                            {draft.slabs.map((s, k) => (
                                <div key={k} className="grid max-w-md grid-cols-[1fr_1fr_auto] items-center gap-2">
                                    <NumericInput mode="decimal" value={k === 0 ? "0" : s.from} disabled={k === 0} onValueChange={(v) => setSlab(k, { from: v })} placeholder="from ₹" aria-label="Slab from" />
                                    <NumericInput mode="decimal" value={s.rate} onValueChange={(v) => setSlab(k, { rate: v })} placeholder="rate %" aria-label="Slab rate" />
                                    <Button type="button" variant="ghost" size="icon" aria-label="Remove slab" disabled={k === 0} onClick={() => set({ slabs: draft.slabs.filter((_, l) => l !== k) })}><Trash2 size={14} /></Button>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" disabled={draft.slabs.length >= 10} onClick={() => set({ slabs: [...draft.slabs, { from: "", rate: "" }] })}><Plus size={14} /> Add slab</Button>
                        </div>
                    )}

                    {/* Who it is for — user kinds, i.e. roles. Nothing ticked = everyone. */}
                    <div className="space-y-1">
                        <div className="text-sm font-medium">Applies to</div>
                        <div className="flex flex-wrap gap-1.5">
                            <Chip on={appliesTo.length === 0} onClick={() => setAppliesTo([])}>Everyone</Chip>
                            {roleChips.map((r) => <Chip key={r} on={appliesTo.includes(r)} onClick={() => toggleRole(r)}>{r}</Chip>)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {appliesTo.length === 0 ? "Every staff member gets this head." : `Only ${appliesTo.join(", ")} get this head; others never see it.`}
                            {roleChips.length === 0 && " No roles found on current staff yet."}
                        </div>
                    </div>

                    <Field label="Description" hint="Shown under the head">
                        {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} placeholder="What this head is for (optional)" />}
                    </Field>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> Active — globally on; an off head reaches nobody</label>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">This head reads as</div>
                    <div className={`mt-1 font-medium ${bad ? "text-destructive" : ""}`}>{bad ?? describeRule(rule, formatRupeesFromPaise)}</div>
                    {!bad && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                            {example.map(({ sales, paise }) => (
                                <li key={sales}>Sells {formatRupeesFromPaise(sales)} in a month → <span className="font-medium text-foreground">{formatRupeesFromPaise(paise)}</span></li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                <Button type="button" disabled={!canSave} onClick={submit}>{saving ? "Saving…" : initial ? "Save head" : "Create head"}</Button>
            </div>
        </div>
    );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={on}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {children}
        </button>
    );
}

function HeaderTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {icon}{children}
        </button>
    );
}
