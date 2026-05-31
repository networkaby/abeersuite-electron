"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Create strategy — /office/pricing-strategy/strategies/create
// Drives the shared <MatchConditions> filter against products, lets the user
// pick the matches, then name + margin → save. UI only for now: sample products,
// and Save is stubbed (the real POST to /api/pricing-strategy/strategies with the
// picked products' shared conditions gets wired next).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Calculator, Filter, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    MatchConditions,
    matchesConditions,
    emptyMatchConditions,
    type Master,
    type MatchConditionsValue,
} from "@/modules/pricing-strategy/components/MatchConditions";
import {
    SAMPLE_BRANDS as BRANDS,
    SAMPLE_CATEGORIES as CATEGORIES,
    SAMPLE_GROUPS as GROUPS,
    SAMPLE_PRODUCTS as SAMPLE,
    getSampleStrategy,
    cloneConditions,
    type SampleProduct as Product,
} from "@/modules/pricing-strategy/lib/sampleStrategies";

const LIST_HREF = "/office/pricing-strategy/strategies";

const nameOf = (list: Master[], id: number | null): string =>
    id == null ? "—" : list.find((m) => m.id === id)?.name ?? "—";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = "2026-05-31";

function rupee(paise: number): string {
    return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function staleDays(p: Product): number {
    if (!p.lastSoldAt) return Infinity;
    const sold = new Date(`${p.lastSoldAt}T00:00:00`);
    if (isNaN(sold.getTime())) return Infinity;
    const now = new Date(`${TODAY}T00:00:00`);
    return Math.floor((now.getTime() - sold.getTime()) / 86_400_000);
}

const staleLabel = (p: Product): string => {
    const d = staleDays(p);
    return d === Infinity ? "never" : `${d}d`;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CreateStrategyPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const editId = Number(searchParams.get("id")) || null;
    const editing = editId != null ? getSampleStrategy(editId) : undefined;

    const [conditions, setConditions] = useState<MatchConditionsValue>(
        () => (editing ? cloneConditions(editing.conditions) : emptyMatchConditions()),
    );
    const [tab, setTab] = useState<"all" | "selected">("all");
    const [filtersOpen, setFiltersOpen] = useState(true);
    const [selectionIds, setSelectionIds] = useState<Set<number>>(new Set());
    const [ticked, setTicked] = useState<Set<number>>(new Set());

    // Name + margin. In edit mode these are bound to inline fields on the page;
    // in create mode they're collected in the dialog after selecting products.
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState(editing ? editing.name : "");
    const [newMargin, setNewMargin] = useState(editing ? String(editing.marginPct) : "25");

    // Count of active condition groups — shown on the Filters toggle badge.
    const activeCount =
        (conditions.brandIds.size > 0 ? 1 : 0) +
        (conditions.groupIds.size > 0 ? 1 : 0) +
        (conditions.categoryIds.size > 0 ? 1 : 0) +
        (conditions.minCost.trim() || conditions.maxCost.trim() ? 1 : 0) +
        (conditions.minStock.trim() || conditions.maxStock.trim() ? 1 : 0) +
        (conditions.minStaleDays.trim() || conditions.maxStaleDays.trim() ? 1 : 0) +
        conditions.attrs.filter((a) => a.key.trim() && a.value.trim()).length;

    const matched = useMemo(
        () =>
            SAMPLE.filter((p) =>
                matchesConditions(
                    {
                        brandId: p.brandId,
                        groupId: p.groupId,
                        categoryId: p.categoryId,
                        costRupees: p.costPaise / 100,
                        stock: p.stock,
                        staleDays: staleDays(p),
                        attrs: p.attrs,
                    },
                    conditions,
                ),
            ),
        [conditions],
    );

    const selectedProducts = useMemo(
        () => SAMPLE.filter((p) => selectionIds.has(p.id)),
        [selectionIds],
    );

    const rows = tab === "all" ? matched : selectedProducts;

    const allTicked = matched.length > 0 && matched.every((p) => ticked.has(p.id));
    const toggleAll = () =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (allTicked) matched.forEach((p) => next.delete(p.id));
            else matched.forEach((p) => next.add(p.id));
            return next;
        });
    const toggleTick = (id: number) =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const addToSelection = () => {
        setSelectionIds((prev) => new Set([...prev, ...ticked]));
        setTicked(new Set());
    };
    const removeFromSelection = (id: number) =>
        setSelectionIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    const clearSelection = () => setSelectionIds(new Set());

    // Opens the name + margin dialog. In edit mode it prefills from the strategy
    // being edited; in create mode it starts blank (and requires a selection).
    const openSaveDialog = () => {
        if (!editing && selectionIds.size === 0) return;
        setNewName(editing ? editing.name : "");
        setNewMargin(editing ? String(editing.marginPct) : "25");
        setCreateOpen(true);
    };

    // UI-only save — the real persistence (POST/PATCH /api/pricing-strategy/strategies
    // with the conditions) gets wired next. Returns to the list afterwards.
    const saveStrategy = () => {
        const name = newName.trim();
        if (!name) return toast.error("Name is required");
        const margin = Number(newMargin);
        if (!Number.isFinite(margin)) return toast.error("Margin % must be a number");
        if (editing) {
            toast.success(`Prototype — strategy "${name}" (${margin}% margin) would be updated.`);
        } else {
            toast.success(`Prototype — strategy "${name}" (${margin}% margin) would be created from ${selectionIds.size} product${selectionIds.size === 1 ? "" : "s"}.`);
        }
        setCreateOpen(false);
        router.push(LIST_HREF);
    };

    const patch = (p: Partial<MatchConditionsValue>) => setConditions((c) => ({ ...c, ...p }));

    const productTable = (
        <div className="overflow-auto rounded-sm border">
            <Table className="[&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1">
                <TableHeader>
                    <TableRow>
                        {tab === "all" ? (
                            <TableHead className="w-8">
                                <Checkbox checked={allTicked} onCheckedChange={toggleAll} aria-label="Select all visible rows" />
                            </TableHead>
                        ) : (
                            <TableHead className="w-8" />
                        )}
                        <TableHead className="w-8 text-xs">#</TableHead>
                        <TableHead className="min-w-[240px] text-xs">Product name</TableHead>
                        <TableHead className="text-xs">Brand</TableHead>
                        <TableHead className="text-xs">Category</TableHead>
                        <TableHead className="text-xs">Group</TableHead>
                        <TableHead className="text-right text-xs">Stock</TableHead>
                        <TableHead className="text-right text-xs">Cost</TableHead>
                        <TableHead className="text-right text-xs">Price</TableHead>
                        <TableHead className="text-right text-xs">MRP</TableHead>
                        <TableHead className="text-right text-xs">Last sale</TableHead>
                        <TableHead className="w-8" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                                {tab === "selected"
                                    ? "No products in selection — tick rows in Matches and click Add to selection."
                                    : "No products match the current conditions."}
                            </TableCell>
                        </TableRow>
                    ) : null}
                    {rows.map((p, i) => (
                        <TableRow key={p.id} data-state={tab === "all" && ticked.has(p.id) ? "selected" : undefined}>
                            <TableCell>
                                {tab === "all" ? (
                                    <Checkbox checked={ticked.has(p.id)} onCheckedChange={() => toggleTick(p.id)} aria-label={`Select ${p.name}`} />
                                ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="text-sm font-medium">{p.name}</TableCell>
                            <TableCell className="text-xs">{nameOf(BRANDS, p.brandId)}</TableCell>
                            <TableCell className="text-xs">{nameOf(CATEGORIES, p.categoryId)}</TableCell>
                            <TableCell className="text-xs">{nameOf(GROUPS, p.groupId)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs ${p.stock <= 0 ? "text-red-600" : ""}`}>{p.stock}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{rupee(p.costPaise)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{rupee(p.pricePaise)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">{rupee(p.mrpPaise)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{staleLabel(p)}</TableCell>
                            <TableCell>
                                {tab === "selected" ? (
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${p.name} from selection`} onClick={() => removeFromSelection(p.id)}>
                                        <X className="size-4" />
                                    </Button>
                                ) : null}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );

    return (
        <div className="h-full overflow-y-auto px-6 pt-4 pb-10">
            <div className="mb-3 flex items-center gap-2">
                <Calculator className="size-5" aria-hidden />
                <h2 className="text-xl font-semibold tracking-tight">
                    {editing ? `Edit strategy — ${editing.name}` : "Create strategy"}
                </h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    UI only · sample data
                </span>
            </div>

            {/* Name + margin — editable inline in edit mode. */}
            {editing ? (
                <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border bg-card p-4 sm:grid-cols-[2fr_1fr]">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Strategy name"
                            className="h-8"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Margin %</Label>
                        <Input
                            inputMode="decimal"
                            value={newMargin}
                            onChange={(e) => setNewMargin(e.target.value)}
                            className="h-8 font-mono text-xs"
                        />
                    </div>
                </div>
            ) : null}

            <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "selected")} className="space-y-3">
                {/* Action toolbar — pinned at the top so the tabs + Add to selection
                    sit directly under the header, above the collapsible filter. */}
                <div className="flex flex-wrap items-center gap-3">
                    <TabsList>
                        <TabsTrigger value="all">Matches{matched.length > 0 ? ` (${matched.length})` : ""}</TabsTrigger>
                        <TabsTrigger value="selected">Selected{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}</TabsTrigger>
                    </TabsList>
                    <Button
                        type="button"
                        variant={filtersOpen ? "secondary" : "outline"}
                        size="sm"
                        className="h-8"
                        onClick={() => setFiltersOpen((o) => !o)}
                    >
                        <Filter className="size-3.5" /> Filters
                        {activeCount > 0 ? (
                            <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">{activeCount}</span>
                        ) : null}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                        <strong className="text-foreground">{matched.length}</strong> / {SAMPLE.length} match
                    </span>
                    <div className="ml-auto flex items-center gap-3">
                        {editing ? (
                            <>
                                <Button type="button" size="sm" className="h-8" onClick={saveStrategy}>
                                    <Save className="size-4" /> Save changes
                                </Button>
                                <Button asChild variant="outline" size="sm" className="h-8">
                                    <Link href={LIST_HREF}>Cancel</Link>
                                </Button>
                            </>
                        ) : tab === "all" ? (
                            <Button type="button" size="sm" className="h-8" onClick={addToSelection} disabled={ticked.size === 0}>
                                <Plus className="size-4" /> Add to selection{ticked.size > 0 ? ` (${ticked.size})` : ""}
                            </Button>
                        ) : (
                            <>
                                <Button type="button" size="sm" className="h-8" onClick={openSaveDialog} disabled={selectionIds.size === 0}>
                                    <Calculator className="size-4" /> Create strategy{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
                                </Button>
                                {selectionIds.size > 0 ? (
                                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={clearSelection}>
                                        <Trash2 className="size-4" /> Clear selection
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {/* Collapsible filter — the SAME block the strategy list/dialog uses. */}
                {filtersOpen ? (
                    <div className="space-y-4 rounded-md border bg-card p-4">
                        <MatchConditions
                            brands={BRANDS}
                            groups={GROUPS}
                            categories={CATEGORIES}
                            value={conditions}
                            onChange={patch}
                        />
                        <div className="flex items-center justify-between border-t pt-3">
                            <span className="text-xs text-muted-foreground">
                                Pick the products this strategy should match, then create it.
                            </span>
                            <button
                                type="button"
                                onClick={() => setConditions(emptyMatchConditions())}
                                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            >
                                Reset conditions
                            </button>
                        </div>
                    </div>
                ) : null}

                <TabsContent value="all">{productTable}</TabsContent>
                <TabsContent value="selected">{productTable}</TabsContent>
            </Tabs>

            {/* Create-strategy mini form — name + margin + save (UI only). */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit strategy" : "Create strategy"}</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">
                        {editing ? (
                            <>Editing — <strong className="text-foreground">{matched.length}</strong> product{matched.length === 1 ? "" : "s"} currently match.</>
                        ) : (
                            <>From <strong className="text-foreground">{selectionIds.size}</strong> selected product{selectionIds.size === 1 ? "" : "s"}.</>
                        )}
                    </p>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Name</Label>
                            <Input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Cameras +25%"
                                className="h-8"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Margin %</Label>
                            <Input
                                inputMode="decimal"
                                value={newMargin}
                                onChange={(e) => setNewMargin(e.target.value)}
                                className="h-8 font-mono text-xs"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" size="sm" onClick={saveStrategy}>
                            {editing ? "Save changes" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
