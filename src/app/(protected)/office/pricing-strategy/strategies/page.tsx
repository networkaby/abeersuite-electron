"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Calculator, X, Search, Tag, FolderTree, Boxes, IndianRupee, Package, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";
import { useDeleteWithConfirm } from "@/shared/hooks";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────

type CostMethod =
    | "WEIGHTED_AVG_COST"
    | "FIFO"
    | "LAST_PURCHASE_COST"
    | "MONTHLY_AVG_COST"
    | "STD_COST";

type AttrOp = "eq" | "in" | "gte" | "lte" | "between";

interface AttrFilterEntry {
    op: AttrOp;
    value: string | number | boolean | (string | number)[];
}

type Strategy = {
    id: number;
    name: string;
    brandIds: number[];
    groupIds: number[];
    categoryIds: number[];
    attrFilters: Record<string, AttrFilterEntry> | null;
    minCostPaise: number | null;
    maxCostPaise: number | null;
    minStock: number | null;
    maxStock: number | null;
    minStaleDays: number | null;
    maxStaleDays: number | null;
    markupPercent: string;
    markupFlatPaise: number;
    roundingPaise: number;
    priority: number;
    costMethod: CostMethod | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};

type Master = { id: number; name: string; parentId?: number | null };

/// Depth-first sort with depth markers so the list shows parents above their
/// children. Items with a missing parent (parentId pointing to nothing in the
/// list) surface at the end so they remain pickable.
function buildHierarchy(rows: Master[]): (Master & { depth: number })[] {
    const byParent = new Map<number | null, Master[]>();
    for (const r of rows) {
        const pid: number | null = r.parentId ?? null;
        const arr = byParent.get(pid) ?? [];
        arr.push(r);
        byParent.set(pid, arr);
    }
    const out: (Master & { depth: number })[] = [];
    const seen = new Set<number>();
    function walk(parent: number | null, depth: number) {
        const kids = (byParent.get(parent) ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const k of kids) {
            if (seen.has(k.id)) continue;
            seen.add(k.id);
            out.push({ ...k, depth });
            walk(k.id, depth + 1);
        }
    }
    walk(null, 0);
    for (const r of rows) {
        if (!seen.has(r.id)) out.push({ ...r, depth: 0 });
    }
    return out;
}

// AttrRow is the editable form representation — value is always a string for
// the user to type freely; we parse to the right shape on save.
type AttrRow = { key: string; op: AttrOp; value: string };

type FormState = {
    name: string;
    brandIds: Set<number>;
    groupIds: Set<number>;
    categoryIds: Set<number>;
    attrs: AttrRow[];
    minCost: string; // rupees decimal (user-facing); paise on save
    maxCost: string;
    minStock: string;
    maxStock: string;
    minStaleDays: string;
    maxStaleDays: string;
    markupPercent: string;
    markupFlatPaise: string;
    roundingPaise: string;
    priority: string;
    costMethod: string; // "__none" sentinel = null
    isActive: boolean;
};

const emptyForm = (): FormState => ({
    name: "",
    brandIds: new Set(),
    groupIds: new Set(),
    categoryIds: new Set(),
    attrs: [],
    minCost: "",
    maxCost: "",
    minStock: "",
    maxStock: "",
    minStaleDays: "",
    maxStaleDays: "",
    markupPercent: "25",
    markupFlatPaise: "0",
    roundingPaise: "0",
    priority: "0",
    costMethod: "__none",
    isActive: true,
});

const COST_METHOD_LABEL: Record<CostMethod, string> = {
    WEIGHTED_AVG_COST: "Weighted Avg",
    FIFO: "FIFO",
    LAST_PURCHASE_COST: "Last Purchase",
    MONTHLY_AVG_COST: "Monthly Avg",
    STD_COST: "Standard",
};

const ATTR_OP_LABEL: Record<AttrOp, string> = {
    eq: "equals",
    in: "in",
    gte: "≥",
    lte: "≤",
    between: "between",
};

// ── Format helpers ─────────────────────────────────────────────────────────

function formatPaise(p: number | null): string {
    if (p == null) return "—";
    if (p === 0) return "₹0";
    return `₹${(p / 100).toFixed(2)}`;
}

function formatRounding(p: number): string {
    if (p === 0) return "Exact";
    if (p >= 100) return `Nearest ₹${(p / 100).toFixed(p % 100 === 0 ? 0 : 2)}`;
    return `Nearest ${p}p`;
}

function rupeesToPaise(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

function paiseToRupees(p: number | null): string {
    return p == null ? "" : (p / 100).toFixed(2);
}

type ItemForCount = { strategyId: number | null };

// ── Multi-select checkbox group ───────────────────────────────────────────
// Inline searchable checkbox list. Renders compact chips for selected ids on
// top, then a search input, then a scrollable checkbox list. No popover —
// keeps the form behaviour boring and predictable.

function MultiSelectGroup({
    label, helper, items, selected, onChange, icon: Icon,
}: {
    label: string;
    helper?: string;
    items: (Master & { depth?: number })[];
    selected: Set<number>;
    onChange: (next: Set<number>) => void;
    icon: React.ComponentType<{ className?: string }>;
}) {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return items;
        return items.filter((m) => m.name.toLowerCase().includes(needle));
    }, [items, q]);

    const toggle = (id: number) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        onChange(next);
    };

    const clearAll = () => onChange(new Set());

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {label}
                    {selected.size > 0 ? (
                        <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                            {selected.size}
                        </Badge>
                    ) : null}
                </Label>
                {selected.size > 0 ? (
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                        Clear
                    </button>
                ) : null}
            </div>
            {helper ? <p className="text-[11px] text-muted-foreground -mt-1">{helper}</p> : null}
            <div className="border border-border rounded-sm bg-card">
                <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={`Filter ${label.toLowerCase()}…`}
                        className="flex-1 bg-transparent outline-none text-xs"
                    />
                </div>
                <div className="max-h-40 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic px-3 py-2">No matches.</p>
                    ) : (
                        filtered.map((m) => (
                            <label
                                key={m.id}
                                className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer"
                                style={m.depth ? { paddingLeft: 8 + m.depth * 14 } : undefined}
                            >
                                <Checkbox
                                    checked={selected.has(m.id)}
                                    onCheckedChange={() => toggle(m.id)}
                                />
                                {m.depth ? (
                                    <span className="text-muted-foreground/60 select-none" aria-hidden>
                                        {"└─"}
                                    </span>
                                ) : null}
                                <span className="truncate">{m.name}</span>
                            </label>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Range filter segment ─────────────────────────────────────────────────
// Bordered card with title + helper + min/max inputs. Each range concept
// (cost, stock, last-sale-age) gets one segment so the visual grouping
// matches the semantics instead of being one undifferentiated 5-column grid.

function RangeSegment({
    icon: Icon, title, helper,
    minLabel, maxLabel,
    minValue, maxValue,
    onMin, onMax,
    inputMode = "decimal",
    placeholderMin, placeholderMax,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    helper: string;
    minLabel: string;
    maxLabel: string;
    minValue: string;
    maxValue: string;
    onMin: (v: string) => void;
    onMax: (v: string) => void;
    inputMode?: "decimal" | "numeric";
    placeholderMin?: string;
    placeholderMax?: string;
}) {
    return (
        <div className="border border-border rounded-sm bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{helper}</p>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{minLabel}</Label>
                    <Input
                        inputMode={inputMode}
                        placeholder={placeholderMin}
                        value={minValue}
                        onChange={(e) => onMin(e.target.value)}
                        className="h-8 font-mono text-xs"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{maxLabel}</Label>
                    <Input
                        inputMode={inputMode}
                        placeholder={placeholderMax}
                        value={maxValue}
                        onChange={(e) => onMax(e.target.value)}
                        className="h-8 font-mono text-xs"
                    />
                </div>
            </div>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PricingStrategiesPage() {
    const [rows, setRows] = useState<Strategy[]>([]);
    const [categories, setCategories] = useState<Master[]>([]);
    const [groups, setGroups] = useState<Master[]>([]);
    const [brands, setBrands] = useState<Master[]>([]);
    const [usage, setUsage] = useState<Map<number, number>>(new Map());
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm());
    const [saving, setSaving] = useState(false);

    const load = () => {
        setLoading(true);
        Promise.all([
            axios.get<Strategy[]>("/api/pricing-strategy/strategies"),
            axios.get<Master[]>("/api/inventory/categories"),
            axios.get<Master[]>("/api/inventory/product-groups"),
            axios.get<Master[]>("/api/inventory/brands"),
            axios.get<ItemForCount[]>("/api/pricing-strategy/items"),
        ])
            .then(([s, c, g, b, items]) => {
                setRows(s.data);
                setCategories(c.data);
                setGroups(g.data);
                setBrands(b.data);
                const counts = new Map<number, number>();
                for (const it of items.data) {
                    if (it.strategyId != null) counts.set(it.strategyId, (counts.get(it.strategyId) ?? 0) + 1);
                }
                setUsage(counts);
            })
            .catch(() => toast.error("Failed to load pricing data"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(emptyForm());
    };

    const save = async () => {
        if (!form.name.trim()) return toast.error("Name is required");

        const markupPercent = Number(form.markupPercent);
        const markupFlat = Number(form.markupFlatPaise);
        const rounding = Number(form.roundingPaise);
        const priority = Number(form.priority);
        if (!Number.isFinite(markupPercent)) return toast.error("Markup % must be a number");
        if (!Number.isFinite(markupFlat) || markupFlat < 0 || !Number.isInteger(markupFlat))
            return toast.error("Flat (paise) must be a non-negative integer");
        if (!Number.isFinite(rounding) || rounding < 0 || !Number.isInteger(rounding))
            return toast.error("Rounding (paise) must be a non-negative integer");
        if (!Number.isFinite(priority) || !Number.isInteger(priority))
            return toast.error("Priority must be an integer");

        // Build attr filter object from form rows.
        const attrFilters: Record<string, AttrFilterEntry> = {};
        for (const row of form.attrs) {
            const key = row.key.trim();
            if (!key) continue;
            const raw = row.value.trim();
            if (raw === "") continue;
            try {
                attrFilters[key] = parseAttrValue(row.op, raw);
            } catch (e) {
                return toast.error(`Attribute "${key}": ${(e as Error).message}`);
            }
        }

        const minCostPaise = rupeesToPaise(form.minCost);
        const maxCostPaise = rupeesToPaise(form.maxCost);
        if (minCostPaise != null && maxCostPaise != null && maxCostPaise < minCostPaise)
            return toast.error("Max cost must be ≥ min cost");

        const minStock = form.minStock.trim() === "" ? null : Number(form.minStock);
        const maxStock = form.maxStock.trim() === "" ? null : Number(form.maxStock);
        if (minStock != null && (!Number.isFinite(minStock) || minStock < 0 || !Number.isInteger(minStock)))
            return toast.error("Min stock must be a non-negative integer");
        if (maxStock != null && (!Number.isFinite(maxStock) || maxStock < 0 || !Number.isInteger(maxStock)))
            return toast.error("Max stock must be a non-negative integer");
        if (minStock != null && maxStock != null && maxStock < minStock)
            return toast.error("Max stock must be ≥ min stock");

        const minStale = form.minStaleDays.trim() === "" ? null : Number(form.minStaleDays);
        const maxStale = form.maxStaleDays.trim() === "" ? null : Number(form.maxStaleDays);
        if (minStale != null && (!Number.isFinite(minStale) || minStale < 0 || !Number.isInteger(minStale)))
            return toast.error("Min stale days must be a non-negative integer");
        if (maxStale != null && (!Number.isFinite(maxStale) || maxStale < 0 || !Number.isInteger(maxStale)))
            return toast.error("Max stale days must be a non-negative integer");
        if (minStale != null && maxStale != null && maxStale < minStale)
            return toast.error("Max stale days must be ≥ min stale days");

        const payload = {
            name: form.name.trim(),
            brandIds: [...form.brandIds],
            groupIds: [...form.groupIds],
            categoryIds: [...form.categoryIds],
            attrFilters: Object.keys(attrFilters).length === 0 ? null : attrFilters,
            minCostPaise,
            maxCostPaise,
            minStock,
            maxStock,
            minStaleDays: minStale,
            maxStaleDays: maxStale,
            markupPercent,
            markupFlatPaise: markupFlat,
            roundingPaise: rounding,
            priority,
            costMethod: form.costMethod === "__none" ? null : (form.costMethod as CostMethod),
            isActive: form.isActive,
        };

        setSaving(true);
        try {
            if (adding) {
                await axios.post("/api/pricing-strategy/strategies", payload);
                toast.success("Strategy created");
            } else if (editId != null) {
                await axios.patch(`/api/pricing-strategy/strategies/${editId}`, payload);
                toast.success("Strategy updated");
            }
            cancel();
            load();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const { remove: del } = useDeleteWithConfirm({
        url: (id) => `/api/pricing-strategy/strategies/${id}`,
        message: () => "Delete this pricing strategy?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    const beginEdit = (s: Strategy) => {
        setAdding(false);
        setEditId(s.id);
        setForm({
            name: s.name,
            brandIds: new Set(s.brandIds),
            groupIds: new Set(s.groupIds),
            categoryIds: new Set(s.categoryIds),
            attrs: s.attrFilters
                ? Object.entries(s.attrFilters).map(([key, e]) => ({
                    key,
                    op: e.op,
                    value: Array.isArray(e.value) ? e.value.join(", ") : String(e.value),
                }))
                : [],
            minCost: paiseToRupees(s.minCostPaise),
            maxCost: paiseToRupees(s.maxCostPaise),
            minStock: s.minStock != null ? String(s.minStock) : "",
            maxStock: s.maxStock != null ? String(s.maxStock) : "",
            minStaleDays: s.minStaleDays != null ? String(s.minStaleDays) : "",
            maxStaleDays: s.maxStaleDays != null ? String(s.maxStaleDays) : "",
            markupPercent: s.markupPercent,
            markupFlatPaise: String(s.markupFlatPaise),
            roundingPaise: String(s.roundingPaise),
            priority: String(s.priority),
            costMethod: s.costMethod ?? "__none",
            isActive: s.isActive,
        });
    };

    const addAttrRow = () =>
        setForm((f) => ({ ...f, attrs: [...f.attrs, { key: "", op: "eq", value: "" }] }));

    const updateAttrRow = (idx: number, patch: Partial<AttrRow>) =>
        setForm((f) => ({
            ...f,
            attrs: f.attrs.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
        }));

    const removeAttrRow = (idx: number) =>
        setForm((f) => ({ ...f, attrs: f.attrs.filter((_, i) => i !== idx) }));

    // Compact summary of a row's conditions for the table.
    const conditionChips = (s: Strategy): React.ReactNode => {
        const chips: React.ReactNode[] = [];
        const labelFor = (ids: number[], list: Master[]): string => {
            if (ids.length === 0) return "";
            if (ids.length === 1) {
                const found = list.find((m) => m.id === ids[0]);
                return found?.name ?? `#${ids[0]}`;
            }
            return `${ids.length} items`;
        };
        if (s.brandIds.length > 0)
            chips.push(<Badge key="b" variant="outline" className="text-[10px]">brand · {labelFor(s.brandIds, brands)}</Badge>);
        if (s.groupIds.length > 0)
            chips.push(<Badge key="g" variant="outline" className="text-[10px]">group · {labelFor(s.groupIds, groups)}</Badge>);
        if (s.categoryIds.length > 0)
            chips.push(<Badge key="c" variant="outline" className="text-[10px]">cat · {labelFor(s.categoryIds, categories)}</Badge>);
        if (s.attrFilters && Object.keys(s.attrFilters).length > 0)
            chips.push(<Badge key="a" variant="outline" className="text-[10px]">attrs · {Object.keys(s.attrFilters).length}</Badge>);
        if (s.minCostPaise != null || s.maxCostPaise != null)
            chips.push(<Badge key="cc" variant="outline" className="text-[10px]">cost {formatPaise(s.minCostPaise)}–{formatPaise(s.maxCostPaise)}</Badge>);
        if (s.minStock != null || s.maxStock != null)
            chips.push(<Badge key="ss" variant="outline" className="text-[10px]">stock {s.minStock ?? "—"}–{s.maxStock ?? "—"}</Badge>);
        if (s.minStaleDays != null || s.maxStaleDays != null) {
            const lo = s.minStaleDays ?? "—";
            const hi = s.maxStaleDays ?? "∞";
            chips.push(<Badge key="st" variant="outline" className="text-[10px]">last sale {lo}–{hi}d ago</Badge>);
        }
        if (chips.length === 0) return <span className="text-xs text-muted-foreground italic">all products</span>;
        return <div className="flex flex-wrap gap-1">{chips}</div>;
    };

    return (
        <div className="flex h-full flex-col gap-3 overflow-hidden px-6 pb-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <Calculator className="size-5" aria-hidden />
                    Strategies
                </h2>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => { setForm(emptyForm()); setEditId(null); setAdding(true); }}
                    disabled={adding}
                >
                    <Plus className="size-4" />
                    New strategy
                </Button>
            </div>

            <Dialog
                open={adding || editId != null}
                onOpenChange={(open) => { if (!open) cancel(); }}
            >
                <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-5xl">
                    <DialogHeader className="border-b px-6 py-4">
                        <DialogTitle>{adding ? "New strategy" : "Edit strategy"}</DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="space-y-4 px-6 py-4">

                        {/* Basics */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="space-y-1.5 lg:col-span-2">
                                <Label className="text-xs">Name</Label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    className="h-8"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Markup %</Label>
                                <Input
                                    inputMode="decimal"
                                    value={form.markupPercent}
                                    onChange={(e) => setForm((f) => ({ ...f, markupPercent: e.target.value }))}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Priority (higher wins)</Label>
                                <Input
                                    inputMode="numeric"
                                    value={form.priority}
                                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Flat add (paise)</Label>
                                <Input
                                    inputMode="numeric"
                                    value={form.markupFlatPaise}
                                    onChange={(e) => setForm((f) => ({ ...f, markupFlatPaise: e.target.value }))}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Rounding (paise)</Label>
                                <Input
                                    inputMode="numeric"
                                    value={form.roundingPaise}
                                    onChange={(e) => setForm((f) => ({ ...f, roundingPaise: e.target.value }))}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Default cost method</Label>
                                <Select
                                    value={form.costMethod}
                                    onValueChange={(v) => setForm((f) => ({ ...f, costMethod: v }))}
                                >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none">— Use item&apos;s own —</SelectItem>
                                        {Object.entries(COST_METHOD_LABEL).map(([v, l]) => (
                                            <SelectItem key={v} value={v}>{l}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <label className="flex items-center gap-2 text-xs self-end pb-2">
                                <Checkbox
                                    checked={form.isActive}
                                    onCheckedChange={(c) => setForm((f) => ({ ...f, isActive: c === true }))}
                                />
                                Active
                            </label>
                        </div>

                        {/* Taxonomy filters (multi-select) */}
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Match conditions <span className="font-normal normal-case">(empty = matches every product)</span>
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <MultiSelectGroup
                                    label="Brands" icon={Tag}
                                    items={brands}
                                    selected={form.brandIds}
                                    onChange={(ids) => setForm((f) => ({ ...f, brandIds: ids }))}
                                />
                                <MultiSelectGroup
                                    label="Groups" icon={FolderTree}
                                    helper="Auto-includes sub-groups."
                                    items={buildHierarchy(groups)}
                                    selected={form.groupIds}
                                    onChange={(ids) => setForm((f) => ({ ...f, groupIds: ids }))}
                                />
                                <MultiSelectGroup
                                    label="Categories" icon={Boxes}
                                    helper="Auto-includes sub-categories."
                                    items={buildHierarchy(categories)}
                                    selected={form.categoryIds}
                                    onChange={(ids) => setForm((f) => ({ ...f, categoryIds: ids }))}
                                />
                            </div>
                        </div>

                        {/* Range filters — three segments */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <RangeSegment
                                icon={IndianRupee}
                                title="Cost range"
                                helper="Applied to InvProduct.costPaise (last-purchase snapshot). Both bounds optional."
                                minLabel="Min ₹"
                                maxLabel="Max ₹"
                                minValue={form.minCost}
                                maxValue={form.maxCost}
                                onMin={(v) => setForm((f) => ({ ...f, minCost: v }))}
                                onMax={(v) => setForm((f) => ({ ...f, maxCost: v }))}
                                inputMode="decimal"
                                placeholderMin="0.00"
                                placeholderMax="∞"
                            />
                            <RangeSegment
                                icon={Package}
                                title="Stock range"
                                helper="Units on hand (InvProduct.stock). Products with stock not tracked are excluded when this filter is set."
                                minLabel="Min units"
                                maxLabel="Max units"
                                minValue={form.minStock}
                                maxValue={form.maxStock}
                                onMin={(v) => setForm((f) => ({ ...f, minStock: v }))}
                                onMax={(v) => setForm((f) => ({ ...f, maxStock: v }))}
                                inputMode="numeric"
                                placeholderMin="0"
                                placeholderMax="∞"
                            />
                            <RangeSegment
                                icon={CalendarClock}
                                title="Days since last sale"
                                helper="Window for staleness. Never-sold products have infinite age — they match the lower bound and fail the upper bound."
                                minLabel="From (days)"
                                maxLabel="To (days)"
                                minValue={form.minStaleDays}
                                maxValue={form.maxStaleDays}
                                onMin={(v) => setForm((f) => ({ ...f, minStaleDays: v }))}
                                onMax={(v) => setForm((f) => ({ ...f, maxStaleDays: v }))}
                                inputMode="numeric"
                                placeholderMin="0"
                                placeholderMax="∞"
                            />
                        </div>

                        {/* Attribute filters */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Attribute filters (attrsJson)
                                </p>
                                <Button type="button" variant="outline" size="sm" onClick={addAttrRow}>
                                    <Plus className="size-3" />
                                    Add row
                                </Button>
                            </div>
                            {form.attrs.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground italic">
                                    No attribute filters. Click <strong>Add row</strong> to gate on values in <code>InvProduct.attrsJson</code>.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {form.attrs.map((row, i) => (
                                        <div key={i} className="grid grid-cols-[1fr_auto_1.5fr_auto] gap-2 items-start">
                                            <Input
                                                placeholder="key (e.g. ram, color)"
                                                value={row.key}
                                                onChange={(e) => updateAttrRow(i, { key: e.target.value })}
                                                className="h-8 text-xs font-mono"
                                            />
                                            <Select
                                                value={row.op}
                                                onValueChange={(v) => updateAttrRow(i, { op: v as AttrOp })}
                                            >
                                                <SelectTrigger className="h-8 w-[110px] text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(Object.keys(ATTR_OP_LABEL) as AttrOp[]).map((op) => (
                                                        <SelectItem key={op} value={op}>{ATTR_OP_LABEL[op]}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Input
                                                placeholder={attrValuePlaceholder(row.op)}
                                                value={row.value}
                                                onChange={(e) => updateAttrRow(i, { value: e.target.value })}
                                                className="h-8 text-xs font-mono"
                                            />
                                            <Button
                                                type="button" variant="ghost" size="icon-sm"
                                                aria-label="Remove"
                                                onClick={() => removeAttrRow(i)}
                                            >
                                                <X className="size-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        </div>
                    </div>
                    <DialogFooter className="border-t px-6 py-3">
                        <Button type="button" variant="outline" size="sm" onClick={cancel}>
                            Cancel
                        </Button>
                        <Button type="button" size="sm" onClick={save} disabled={saving}>
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ScrollArea className="min-h-0 flex-1 border border-border rounded-sm bg-card">
                <Table>
                    <TableHeader className="bg-muted/40">
                        <TableRow>
                            <TableHead className="text-xs">Name</TableHead>
                            <TableHead className="text-xs">Conditions</TableHead>
                            <TableHead className="text-right text-xs">Markup %</TableHead>
                            <TableHead className="text-right text-xs">Flat</TableHead>
                            <TableHead className="text-xs">Rounding</TableHead>
                            <TableHead className="text-right text-xs">Priority</TableHead>
                            <TableHead className="text-xs">Cost method</TableHead>
                            <TableHead className="text-right text-xs">Used by</TableHead>
                            <TableHead className="text-right text-xs w-20" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={9} />
                        ) : rows.length === 0 ? (
                            <TableEmptyRow colSpan={9} message="No pricing strategies yet." />
                        ) : (
                            rows.map((s) => (
                                <TableRow key={s.id}>
                                    <TableCell className="font-medium text-sm">
                                        {s.name}
                                        {!s.isActive ? (
                                            <Badge variant="outline" className="ml-2 text-[10px]">inactive</Badge>
                                        ) : null}
                                    </TableCell>
                                    <TableCell>{conditionChips(s)}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{Number(s.markupPercent).toFixed(2)}%</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{formatPaise(s.markupFlatPaise)}</TableCell>
                                    <TableCell className="text-xs">{formatRounding(s.roundingPaise)}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{s.priority}</TableCell>
                                    <TableCell className="text-xs">
                                        {s.costMethod ? COST_METHOD_LABEL[s.costMethod] : <span className="text-muted-foreground">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right text-xs">
                                        {(() => {
                                            const n = usage.get(s.id) ?? 0;
                                            if (n === 0) return <span className="text-muted-foreground">—</span>;
                                            return (
                                                <Link
                                                    href={`/office/pricing-strategy/items?strategy=${s.id}`}
                                                    className="underline text-blue-700 hover:text-blue-900"
                                                    title="Open Items filtered to this strategy"
                                                >
                                                    {n} {n === 1 ? "product" : "products"}
                                                </Link>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="text-right space-x-1 whitespace-nowrap">
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => beginEdit(s)}>
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(s.id)}>
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>

            <p className="flex-none text-[11px] text-muted-foreground leading-relaxed">
                A strategy <strong>AND-matches</strong> every condition it specifies; an empty conditions set
                matches all products (the org-wide fallback). When multiple strategies match a product,
                the highest <strong>priority</strong> wins.
            </p>
        </div>
    );
}

// ── Attribute value parsing ───────────────────────────────────────────────

function attrValuePlaceholder(op: AttrOp): string {
    switch (op) {
        case "eq": return "Black";
        case "in": return "Black, White, Silver";
        case "gte":
        case "lte": return "100";
        case "between": return "100, 500";
    }
}

function parseAttrValue(op: AttrOp, raw: string): AttrFilterEntry {
    if (op === "in") {
        const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) throw new Error("'in' needs at least one value (comma-separated)");
        // `in` lists only hold scalars (string | number); a "true"/"false" entry
        // stays a literal string rather than coercing to boolean.
        const value: (string | number)[] = parts.map((p) => {
            const c = coerce(p);
            return typeof c === "boolean" ? p : c;
        });
        return { op, value };
    }
    if (op === "between") {
        const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length !== 2) throw new Error("'between' needs exactly two values (min, max)");
        const lo = coerce(parts[0]);
        const hi = coerce(parts[1]);
        if (typeof lo !== "number" || typeof hi !== "number")
            throw new Error("'between' values must be numeric");
        if (hi < lo) throw new Error("max must be ≥ min");
        return { op, value: [lo, hi] };
    }
    // eq / gte / lte — single scalar.
    return { op, value: coerce(raw) };
}

/** "123" → 123, "Black" → "Black", "true"/"false" → boolean. */
function coerce(s: string): string | number | boolean {
    const lower = s.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    const n = Number(s);
    return Number.isFinite(n) && s.trim() !== "" ? n : s;
}
