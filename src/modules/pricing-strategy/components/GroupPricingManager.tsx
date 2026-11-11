"use client";

// Pricing Strategy → Group pricing — the one home of the customer-group
// master (it replaced Settings → Customer Groups). Add / rename / switch off /
// delete a group here; pick one and give it a price rule per product group
// (MRP / print price / profit sharing X% / revenue discount X%) and tick which
// automatic benefits it may get. Name and Active save on their own (the group
// master API the customer Profile tab also reads); the price list is saved as
// a unit per group. POS only; nothing about it prints — see groupPricing.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { NumericInput } from "@/shared/components/NumericInput";
import { FieldSaveMark } from "@/shared/components/FieldSaveMark";
import { useFieldSave } from "@/shared/hooks/useFieldSave";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { extractApiError } from "@/shared/lib/api";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { treeSelectOptions } from "@/shared/lib/tree";
import {
    GROUP_PRICE_TYPES, GROUP_PRICE_TYPE_LABEL, pctPriceType, type GroupPriceType,
} from "@/modules/pricing-strategy/lib/groupPricing";

type Rule = { productGroupId: number | null; priceType: GroupPriceType; pct: number | null };
type GroupRow = {
    id: number; name: string; isActive: boolean; members: number;
    allowTierDiscount: boolean; allowCoupons: boolean; allowLoyalty: boolean;
    rules: Rule[];
};
type ProductGroup = { id: number; name: string; parentId: number | null; isActive: boolean };
type Resp = { groups: GroupRow[]; productGroups: ProductGroup[] };

/** Editable copy of one group — % kept as the typed string (no number inputs). */
type DraftRule = { key: number; productGroupId: number | null; priceType: GroupPriceType; pctStr: string };
type Draft = { allowTierDiscount: boolean; allowCoupons: boolean; allowLoyalty: boolean; rules: DraftRule[] };

/** Sentinel option value for the "All items" row (SearchableSelect needs a number). */
const ALL_ITEMS = 0;

const PRICE_TYPE_HINT: Record<GroupPriceType, string> = {
    MRP: "Bill at the item's MRP",
    PRINT_PRICE: "Bill at the barcode sticker price",
    PROFIT_SHARE: "Give back this % of the profit left after other discounts",
    REVENUE_DISCOUNT: "Take this % off the price left after other discounts",
};

const BENEFITS: { key: "allowTierDiscount" | "allowCoupons" | "allowLoyalty"; label: string }[] = [
    { key: "allowTierDiscount", label: "Tier discount" },
    { key: "allowCoupons", label: "Coupons" },
    { key: "allowLoyalty", label: "Loyalty (earn and redeem)" },
];

let nextKey = 1;
const toDraft = (g: GroupRow): Draft => ({
    allowTierDiscount: g.allowTierDiscount,
    allowCoupons: g.allowCoupons,
    allowLoyalty: g.allowLoyalty,
    rules: g.rules.map((r) => ({ key: nextKey++, productGroupId: r.productGroupId, priceType: r.priceType, pctStr: r.pct == null ? "" : String(r.pct) })),
});
const draftSig = (d: Draft) => JSON.stringify({ ...d, rules: d.rules.map(({ key: _k, ...r }) => r) });

export function GroupPricingManager() {
    const [data, setData] = useState<Resp | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [newName, setNewName] = useState("");
    const [adding, setAdding] = useState(false);
    const { save: saveField, stateOf } = useFieldSave();

    const load = useCallback((silent = false) => {
        axios.get<Resp>("/api/pricing-strategy/group-pricing")
            .then((res) => setData(res.data))
            .catch(() => { if (!silent) toast.error("Could not load group pricing"); });
    }, []);
    useEffect(() => { load(); }, [load]);
    // A background refresh only replaces the saved copy — the open draft is
    // the user's until they save or undo.
    useRealtimeTopics(["parties", "catalogue"], () => { load(true); });

    const groups = useMemo(() => data?.groups ?? [], [data]);
    const selected = groups.find((g) => g.id === selectedId) ?? null;

    // First load → open the first group (while rendering; picking one ends it).
    if (selectedId == null && groups.length > 0) {
        setSelectedId(groups[0].id);
        setDraft(toDraft(groups[0]));
    }

    const dirty = !!(selected && draft && draftSig(draft) !== draftSig(toDraft(selected)));

    /** Unsaved price-list edits are the user's — ask before dropping them. */
    const leaveDraft = async () => !dirty || confirmAction({
        title: `Leave ${selected?.name ?? "this group"} without saving?`,
        body: "The changes you made to its pricing will be lost.",
        confirmLabel: "Leave",
    });

    const pick = async (g: GroupRow) => {
        if (g.id === selectedId) return;
        if (!(await leaveDraft())) return;
        setSelectedId(g.id);
        setDraft(toDraft(g));
    };

    /** Merge a master change (name / active) into the list without touching the draft. */
    const patchGroupRow = (id: number, patch: Partial<GroupRow>) =>
        setData((d) => d && { ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

    const addGroup = async () => {
        const name = newName.trim();
        if (!name) { toast.error("Give the group a name"); return; }
        if (!(await leaveDraft())) return;
        setAdding(true);
        try {
            const { data: row } = await axios.post<{ id: number; name: string; isActive: boolean }>("/api/settings/customer-groups", { name });
            const fresh: GroupRow = {
                id: row.id, name: row.name, isActive: row.isActive, members: 0,
                allowTierDiscount: true, allowCoupons: true, allowLoyalty: true, rules: [],
            };
            setData((d) => d && { ...d, groups: [...d.groups, fresh].sort((a, b) => a.name.localeCompare(b.name)) });
            setSelectedId(fresh.id);
            setDraft(toDraft(fresh));
            setNewName("");
            toast.success(`Group "${row.name}" added`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the group"));
        } finally {
            setAdding(false);
        }
    };

    const setActive = async (g: GroupRow, isActive: boolean) => {
        patchGroupRow(g.id, { isActive });
        try {
            await axios.patch(`/api/settings/customer-groups/${g.id}`, { isActive });
        } catch (e) {
            patchGroupRow(g.id, { isActive: g.isActive });
            toast.error(extractApiError(e, "Could not update the group"));
        }
    };

    const removeGroup = async (g: GroupRow) => {
        const ok = await confirmAction({
            title: `Delete group "${g.name}"?`,
            body: `${g.members > 0 ? `${g.members} customer(s) will be taken out of it. ` : ""}Its pricing goes with it. This cannot be undone.`,
            confirmLabel: "Delete",
        });
        if (!ok) return;
        try {
            await axios.delete(`/api/settings/customer-groups/${g.id}`);
            const rest = groups.filter((x) => x.id !== g.id);
            setData((d) => d && { ...d, groups: rest });
            setSelectedId(rest[0]?.id ?? null);
            setDraft(rest[0] ? toDraft(rest[0]) : null);
            toast.success(`Group "${g.name}" deleted`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the group"));
        }
    };

    const groupOptions = useMemo(() => [
        { value: ALL_ITEMS, label: "All items", searchText: "all items" },
        ...treeSelectOptions((data?.productGroups ?? []).filter((g) => g.isActive)),
    ], [data]);

    const patchRule = (key: number, patch: Partial<DraftRule>) =>
        setDraft((d) => d && { ...d, rules: d.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

    const addRule = () => setDraft((d) => d && {
        ...d, rules: [...d.rules, { key: nextKey++, productGroupId: null, priceType: "MRP", pctStr: "" }],
    });

    const save = async () => {
        if (!selected || !draft) return;
        const used = new Set<string>();
        for (const r of draft.rules) {
            const k = String(r.productGroupId);
            if (used.has(k)) {
                toast.error(r.productGroupId == null ? "Only one All items row" : "A product group is listed twice");
                return;
            }
            used.add(k);
            if (pctPriceType(r.priceType) && !(Number(r.pctStr) > 0)) {
                toast.error(`Give the % for ${GROUP_PRICE_TYPE_LABEL[r.priceType]}`);
                return;
            }
        }
        setSaving(true);
        try {
            await axios.put(`/api/pricing-strategy/group-pricing/${selected.id}`, {
                allowTierDiscount: draft.allowTierDiscount,
                allowCoupons: draft.allowCoupons,
                allowLoyalty: draft.allowLoyalty,
                rules: draft.rules.map((r) => ({
                    productGroupId: r.productGroupId,
                    priceType: r.priceType,
                    pct: pctPriceType(r.priceType) ? Number(r.pctStr) : null,
                })),
            });
            // Fold the saved draft into the list so `dirty` clears at once.
            const saved: GroupRow = {
                ...selected,
                allowTierDiscount: draft.allowTierDiscount,
                allowCoupons: draft.allowCoupons,
                allowLoyalty: draft.allowLoyalty,
                rules: draft.rules.map((r) => ({
                    productGroupId: r.productGroupId,
                    priceType: r.priceType,
                    pct: pctPriceType(r.priceType) ? Number(r.pctStr) : null,
                })),
            };
            setData((d) => d && { ...d, groups: d.groups.map((g) => (g.id === saved.id ? saved : g)) });
            setDraft(toDraft(saved));
            toast.success(`${selected.name} pricing saved`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not save group pricing"));
        } finally {
            setSaving(false);
        }
    };

    if (!data) return <p className="px-6 pt-4 text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-4 px-6 pt-3 pb-6">
            {/* Customer groups */}
            <div className="flex min-h-0 flex-col rounded-lg border border-border p-1.5">
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer groups</p>
                <div className="min-h-0 flex-1 overflow-auto">
                {groups.length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No groups yet — add the first one below.</p>
                )}
                {groups.map((g) => (
                    <button
                        key={g.id}
                        type="button"
                        onClick={() => void pick(g)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${g.id === selectedId ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
                    >
                        <span className={`truncate ${g.isActive ? "" : "text-muted-foreground line-through"}`}>{g.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground" title="Price rules">{g.rules.length}</span>
                    </button>
                ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1 border-t border-border pt-1.5">
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void addGroup(); }}
                        placeholder="New group"
                        aria-label="New group name"
                        className="h-8 text-sm"
                    />
                    <Button size="icon-sm" variant="outline" title="Add group" onClick={() => void addGroup()} disabled={adding}>
                        <Plus size={14} />
                    </Button>
                </div>
            </div>

            {/* The selected group's price list */}
            {selected && draft && (
                <div className="min-h-0 space-y-4 overflow-auto">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                {/* Rename — saves on blur; an emptied box puts the old name back. */}
                                <Input
                                    key={`${selected.id}:${selected.name}`}
                                    defaultValue={selected.name}
                                    aria-label="Group name"
                                    className="h-8 w-64 text-base font-semibold"
                                    onBlur={(e) => {
                                        const input = e.currentTarget;
                                        const next = input.value.trim();
                                        if (!next) {
                                            input.value = selected.name;
                                            if (selected.name) toast.error("A group needs a name — kept the old one");
                                            return;
                                        }
                                        void saveField({
                                            key: `${selected.id}:name`,
                                            original: selected.name,
                                            next,
                                            label: "Group name",
                                            write: (v) => axios.patch(`/api/settings/customer-groups/${selected.id}`, { name: v }),
                                            revert: (v) => { input.value = v; },
                                            onSaved: (v) => patchGroupRow(selected.id, { name: v }),
                                        });
                                    }}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                />
                                <FieldSaveMark state={stateOf(`${selected.id}:name`)} />
                                <label className="flex items-center gap-2 text-sm">
                                    <Switch checked={selected.isActive} onCheckedChange={(v) => void setActive(selected, v)} />
                                    Active
                                </label>
                                {!selected.isActive && (
                                    <Badge variant="outline" title="Hidden from the customer Profile tab, and its rules are off">Rules off</Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {selected.members} customer{selected.members === 1 ? "" : "s"} · assign a group on the customer&apos;s Profile tab · POS only · the customer never sees any of this
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => void removeGroup(selected)} title="Delete this group">
                                <Trash2 size={14} className="mr-1 text-destructive" /> Delete
                            </Button>
                            {dirty && (
                                <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(selected))}>
                                    <Undo2 size={14} className="mr-1" /> Undo
                                </Button>
                            )}
                            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                                <Save size={14} className="mr-1" /> Save
                            </Button>
                        </div>
                    </div>

                    {/* Benefit ticks */}
                    <div className="rounded-lg border border-border p-3">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Benefits this group gets</p>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {BENEFITS.map((b) => (
                                <label key={b.key} className="flex items-center gap-2 text-sm">
                                    <Switch
                                        checked={draft[b.key]}
                                        onCheckedChange={(v) => setDraft((d) => d && { ...d, [b.key]: v })}
                                    />
                                    {b.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Price rules */}
                    <div className="rounded-lg border border-border">
                        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_90px_36px] items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <span>Product group</span>
                            <span>Price type</span>
                            <span>%</span>
                            <span />
                        </div>
                        {draft.rules.length === 0 && (
                            <p className="px-3 py-4 text-sm text-muted-foreground">No rules — everyone in this group pays the normal sale price.</p>
                        )}
                        {draft.rules.map((r) => (
                            <div key={r.key} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_90px_36px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                                <SearchableSelect<number>
                                    value={r.productGroupId ?? ALL_ITEMS}
                                    options={groupOptions}
                                    onChange={(v) => patchRule(r.key, { productGroupId: v == null || v === ALL_ITEMS ? null : v })}
                                    clearable={false}
                                    triggerClassName="h-8 text-sm"
                                    ariaLabel="Product group"
                                />
                                <Select value={r.priceType} onValueChange={(v) => patchRule(r.key, { priceType: v as GroupPriceType })}>
                                    <SelectTrigger className="h-8 text-sm" title={PRICE_TYPE_HINT[r.priceType]}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GROUP_PRICE_TYPES.map((t) => (
                                            <SelectItem key={t} value={t}>{GROUP_PRICE_TYPE_LABEL[t]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {pctPriceType(r.priceType) ? (
                                    <NumericInput
                                        value={r.pctStr}
                                        onValueChange={(v) => patchRule(r.key, { pctStr: v })}
                                        mode="decimal"
                                        min={0}
                                        max={100}
                                        placeholder="%"
                                        className="h-8 text-sm"
                                        aria-label="Percent"
                                    />
                                ) : (
                                    <span className="text-sm text-muted-foreground">—</span>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title="Remove rule"
                                    onClick={() => setDraft((d) => d && { ...d, rules: d.rules.filter((x) => x.key !== r.key) })}
                                >
                                    <Trash2 size={14} className="text-destructive" />
                                </Button>
                            </div>
                        ))}
                        <div className="px-3 py-2">
                            <Button variant="outline" size="sm" onClick={addRule}>
                                <Plus size={14} className="mr-1" /> Add rule
                            </Button>
                        </div>
                    </div>

                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                        <li>A rule on a parent product group covers all its sub-groups; a sub-group&apos;s own rule wins.</li>
                        <li>Items in no listed group get the All items rule, or the normal sale price if there is none.</li>
                        <li>MRP and Print price set the line&apos;s starting price. The cashier can still change it.</li>
                        <li>Profit sharing and Revenue discount are worked out last, after tier, coupon, loyalty and manual discounts, and only while some profit is left. The price never goes below cost, and discount-protected items are left alone.</li>
                        <li>A customer with No discount switched on (Quality tab) gets none of the benefits or rebates. MRP and Print price still apply.</li>
                    </ul>
                </div>
            )}
        </div>
    );
}
