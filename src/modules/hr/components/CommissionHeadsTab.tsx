"use client";

// Set commission — a catalogue of commission / target HEADS, the way the
// coupons page is a catalogue of offers. Owner, 2026-09-22: *"in set commission
// page is like coupon page here we create different commission or target head
// its not user specific. just do the tab only wiring later."* Then: *"user kind
// applicable"* — a head says which kinds of user (roles) it is for.
//
// A head is one named way of earning: "1% on every sale", "₹1,500 at ₹1 lakh",
// a slab ladder. Heads are created here once; the Per person tab then shows
// each person the heads that apply to their role, with a per-person override.
// UI ONLY for now — the list lives in the board's component state with a few
// sample heads so the screen can be judged; nothing is saved. The rule
// arithmetic it previews is the real one (shared/lib/hr/commissionScheme.ts).

import { useMemo, useState, type ReactNode } from "react";
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
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import {
    COMMISSION_KINDS, COMMISSION_KIND_LABELS, computeCommission, describeRule,
    type CommissionKind, type CommissionRule,
} from "@/shared/lib/hr/commissionScheme";
import { blankRule, parseRule, toDraft, type RuleDraft } from "./CommissionSchemeDialog";

/** One head as the screens hold it — not yet a table row anywhere. */
export interface CommissionHead {
    id: number;
    name: string;
    description: string;
    rule: CommissionRule;
    /** Globally on. An off head reaches nobody, whatever the overrides say. */
    active: boolean;
    /** Role labels this head is for. Empty = everyone. */
    appliesTo: string[];
}

const L = 100_000_00;
export const SAMPLE_HEADS: CommissionHead[] = [
    { id: 1, name: "Counter commission", description: "On every bill the person rings.", rule: { kind: "PERCENT", targetPaise: 0, rateBp: 100, slabs: [], bonusPaise: 0 }, active: true, appliesTo: [] },
    { id: 2, name: "Monthly target bonus", description: "Flat bonus the month the target is crossed.", rule: { kind: "BONUS", targetPaise: L, rateBp: 0, slabs: [], bonusPaise: 1500_00 }, active: true, appliesTo: [] },
    { id: 3, name: "Star seller", description: "Extra share once past the stretch target.", rule: { kind: "ABOVE_TARGET", targetPaise: 2 * L, rateBp: 200, slabs: [], bonusPaise: 0 }, active: false, appliesTo: [] },
];

/** Does this head reach a person of this role? */
export const headAppliesTo = (h: CommissionHead, role: string | null) => h.appliesTo.length === 0 || (!!role && h.appliesTo.includes(role));

export const KIND_BADGE: Record<CommissionKind, string> = {
    PERCENT:      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300",
    ABOVE_TARGET: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300",
    SLABS:        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
    BONUS:        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
};
export const KIND_SHORT: Record<CommissionKind, string> = { PERCENT: "Share of sales", ABOVE_TARGET: "Above target", SLABS: "Slabs", BONUS: "Target bonus" };

export default function CommissionHeadsTab({ heads, setHeads, roles, canEdit }: {
    heads: CommissionHead[];
    setHeads: (fn: (hs: CommissionHead[]) => CommissionHead[]) => void;
    /** Every role label the current staff carry — the "user kinds" a head can be limited to. */
    roles: string[];
    canEdit: boolean;
}) {
    const [view, setView] = useState<"LIST" | "CREATE">("LIST");
    const [editing, setEditing] = useState<CommissionHead | null>(null);
    const [search, setSearch] = useState("");
    const [kindFilter, setKindFilter] = useState<"ALL" | CommissionKind>("ALL");

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return heads.filter((h) => (kindFilter === "ALL" || h.rule.kind === kindFilter) && (!q || h.name.toLowerCase().includes(q) || h.description.toLowerCase().includes(q)));
    }, [heads, search, kindFilter]);

    const openCreate = () => { setEditing(null); setView("CREATE"); };
    const openEdit = (h: CommissionHead) => { setEditing(h); setView("CREATE"); };
    const save = (h: Omit<CommissionHead, "id">) => {
        setHeads((hs) => editing ? hs.map((x) => (x.id === editing.id ? { ...x, ...h } : x)) : [...hs, { ...h, id: Math.max(0, ...hs.map((x) => x.id)) + 1 }]);
        setEditing(null);
        setView("LIST");
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
                A head is one way of earning — a share of sales, a bonus at a target, a slab ladder. Create the heads here once and say which kinds of user they are for; each person&apos;s own overrides live on the Per person tab. <span className="font-medium text-foreground">Preview only: nothing here is saved yet.</span>
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
                                        <Switch checked={h.active} disabled={!canEdit} aria-label={`${h.name} active`}
                                            onCheckedChange={(v) => setHeads((hs) => hs.map((x) => (x.id === h.id ? { ...x, active: v } : x)))} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {canEdit && (
                                            <div className="flex justify-end gap-0.5">
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit head" onClick={() => openEdit(h)}><Pencil size={14} /></Button>
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete head" onClick={() => setHeads((hs) => hs.filter((x) => x.id !== h.id))}><Trash2 size={14} /></Button>
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
function HeadForm({ initial, roles, onCancel, onSave }: { initial: CommissionHead | null; roles: string[]; onCancel: () => void; onSave: (h: Omit<CommissionHead, "id">) => void }) {
    const [name, setName] = useState(initial?.name ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    const [active, setActive] = useState(initial?.active ?? true);
    const [appliesTo, setAppliesTo] = useState<string[]>(initial?.appliesTo ?? []);
    const [draft, setDraft] = useState<RuleDraft>(() => (initial ? toDraft(initial.rule) : blankRule()));
    const { rule, bad } = useMemo(() => parseRule(draft), [draft]);
    const canSave = !bad && name.trim().length > 0;
    const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
    const setSlab = (k: number, patch: Partial<RuleDraft["slabs"][number]>) => setDraft((d) => ({ ...d, slabs: d.slabs.map((s, l) => (l === k ? { ...s, ...patch } : s)) }));
    const toggleRole = (r: string) => setAppliesTo((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
    // A role from an earlier save that nobody carries today still shows, so it can be unticked.
    const roleChips = useMemo(() => [...new Set([...roles, ...appliesTo])].sort(), [roles, appliesTo]);

    const example = useMemo(() => {
        const base = rule.targetPaise > 0 ? rule.targetPaise : L;
        return [base, Math.round(base * 1.2)].map((sales) => ({ sales, paise: computeCommission({ rules: [rule] }, sales).totalPaise }));
    }, [rule]);

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
                            <div className="text-xs text-muted-foreground">Each slab&apos;s rate is paid on the sales inside it — like tax slabs, so crossing a line never loses money.</div>
                            {draft.slabs.map((s, k) => (
                                <div key={k} className="grid max-w-md grid-cols-[1fr_1fr_auto] items-center gap-2">
                                    <NumericInput mode="decimal" value={s.from} onValueChange={(v) => setSlab(k, { from: v })} placeholder={k === 0 ? "from ₹0" : "from ₹"} aria-label="Slab from" />
                                    <NumericInput mode="decimal" value={s.rate} onValueChange={(v) => setSlab(k, { rate: v })} placeholder="rate %" aria-label="Slab rate" />
                                    <Button type="button" variant="ghost" size="icon" aria-label="Remove slab" disabled={draft.slabs.length <= 1} onClick={() => set({ slabs: draft.slabs.filter((_, l) => l !== k) })}><Trash2 size={14} /></Button>
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

                    <Field label="Description" hint="Shown under the head, and to the person on My Info">
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
                <Button type="button" disabled={!canSave} onClick={() => onSave({ name: name.trim(), description: description.trim(), rule, active, appliesTo })}>{initial ? "Save head" : "Create head"}</Button>
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
