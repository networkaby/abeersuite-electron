"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type Scope = "ORG" | "CATEGORY" | "GROUP" | "BRAND";

type Strategy = {
    id:              number;
    name:            string;
    scope:           Scope;
    scopeId:         number | null;
    markupPercent:   string; // Decimal arrives as string
    markupFlatPaise: number;
    roundingPaise:   number;
    priority:        number;
    isActive:        boolean;
};

type Master = { id: number; name: string };

type FormState = {
    name:            string;
    scope:           Scope;
    scopeId:         string; // string for the Select; "" when ORG
    markupPercent:   string;
    markupFlatPaise: string;
    roundingPaise:   string;
    priority:        string;
    isActive:        boolean;
};

const emptyForm: FormState = {
    name:            "",
    scope:           "ORG",
    scopeId:         "",
    markupPercent:   "25",
    markupFlatPaise: "0",
    roundingPaise:   "0",
    priority:        "0",
    isActive:        true,
};

const SCOPE_LABEL: Record<Scope, string> = {
    ORG:      "Org-wide default",
    CATEGORY: "Category",
    GROUP:    "Product group",
    BRAND:    "Brand",
};

function formatPaise(p: number): string {
    if (p === 0) return "₹0";
    return `₹${(p / 100).toFixed(2)}`;
}

function formatRounding(p: number): string {
    if (p === 0) return "Exact";
    if (p >= 100) return `Nearest ₹${(p / 100).toFixed(p % 100 === 0 ? 0 : 2)}`;
    return `Nearest ${p}p`;
}

type ItemForCount = { strategyId: number | null };

export default function PricingStrategiesPage() {
    const [rows,       setRows] = useState<Strategy[]>([]);
    const [categories, setCategories] = useState<Master[]>([]);
    const [groups,     setGroups] = useState<Master[]>([]);
    const [brands,     setBrands] = useState<Master[]>([]);
    const [usage,      setUsage] = useState<Map<number, number>>(new Map());
    const [loading,    setLoading] = useState(true);
    const [adding,     setAdding] = useState(false);
    const [editId,     setEditId] = useState<number | null>(null);
    const [form,       setForm] = useState<FormState>(emptyForm);
    const [saving,     setSaving] = useState(false);

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
                setCategories(c.data.filter((x) => "isActive" in x ? (x as Master & { isActive: boolean }).isActive : true));
                setGroups(g.data.filter((x) => "isActive" in x ? (x as Master & { isActive: boolean }).isActive : true));
                setBrands(b.data.filter((x) => "isActive" in x ? (x as Master & { isActive: boolean }).isActive : true));
                const counts = new Map<number, number>();
                for (const it of items.data) {
                    if (it.strategyId != null) counts.set(it.strategyId, (counts.get(it.strategyId) ?? 0) + 1);
                }
                setUsage(counts);
            })
            .catch(() => toast.error("Failed to load pricing data"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const scopeOptions = useMemo<Master[]>(() => {
        if (form.scope === "CATEGORY") return categories;
        if (form.scope === "GROUP")    return groups;
        if (form.scope === "BRAND")    return brands;
        return [];
    }, [form.scope, categories, groups, brands]);

    const scopeIdLabelOf = (s: Strategy): string => {
        if (s.scope === "ORG") return "—";
        const list =
            s.scope === "CATEGORY" ? categories :
            s.scope === "GROUP"    ? groups     :
            brands;
        return list.find((m) => m.id === s.scopeId)?.name ?? `#${s.scopeId}`;
    };

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(emptyForm);
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        const markupPercent = Number(form.markupPercent);
        const markupFlat    = Number(form.markupFlatPaise);
        const rounding      = Number(form.roundingPaise);
        const priority      = Number(form.priority);
        if (!Number.isFinite(markupPercent)) return toast.error("Markup % must be a number");
        if (!Number.isFinite(markupFlat) || markupFlat < 0 || !Number.isInteger(markupFlat))
            return toast.error("Flat (paise) must be a non-negative integer");
        if (!Number.isFinite(rounding) || rounding < 0 || !Number.isInteger(rounding))
            return toast.error("Rounding (paise) must be a non-negative integer");
        if (!Number.isFinite(priority) || !Number.isInteger(priority))
            return toast.error("Priority must be an integer");

        const scopeId = form.scope === "ORG" ? null : Number(form.scopeId);
        if (form.scope !== "ORG" && (!Number.isFinite(scopeId) || scopeId === null || scopeId <= 0)) {
            return toast.error(`Select a ${SCOPE_LABEL[form.scope].toLowerCase()} for the scope`);
        }

        const payload = {
            name:            form.name.trim(),
            scope:           form.scope,
            scopeId,
            markupPercent,
            markupFlatPaise: markupFlat,
            roundingPaise:   rounding,
            priority,
            isActive:        form.isActive,
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
        url:          (id) => `/api/pricing-strategy/strategies/${id}`,
        message:      () => "Delete this pricing strategy?",
        errorMessage: "Delete failed",
        onSuccess:    () => load(),
    });

    const beginEdit = (s: Strategy) => {
        setAdding(false);
        setEditId(s.id);
        setForm({
            name:            s.name,
            scope:           s.scope,
            scopeId:         s.scopeId != null ? String(s.scopeId) : "",
            markupPercent:   s.markupPercent,
            markupFlatPaise: String(s.markupFlatPaise),
            roundingPaise:   String(s.roundingPaise),
            priority:        String(s.priority),
            isActive:        s.isActive,
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <Calculator className="size-5" aria-hidden />
                    Strategies
                </h2>
                <Button
                    type="button"
                    onClick={() => { setForm(emptyForm); setEditId(null); setAdding(true); }}
                    disabled={adding}
                >
                    <Plus className="size-4" />
                    New strategy
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New strategy" : "Edit strategy"}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Scope</Label>
                            <Select
                                value={form.scope}
                                onValueChange={(v) =>
                                    setForm((f) => ({ ...f, scope: v as Scope, scopeId: "" }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ORG">Org-wide default</SelectItem>
                                    <SelectItem value="CATEGORY">Category</SelectItem>
                                    <SelectItem value="GROUP">Product group</SelectItem>
                                    <SelectItem value="BRAND">Brand</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {form.scope !== "ORG" ? (
                            <div className="space-y-2">
                                <Label>{SCOPE_LABEL[form.scope]}</Label>
                                <Select
                                    value={form.scopeId}
                                    onValueChange={(v) => setForm((f) => ({ ...f, scopeId: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {scopeOptions.length === 0 ? (
                                            <SelectItem value="__none" disabled>
                                                None available
                                            </SelectItem>
                                        ) : (
                                            scopeOptions.map((m) => (
                                                <SelectItem key={m.id} value={String(m.id)}>
                                                    {m.name}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                        <div className="space-y-2">
                            <Label>Markup %</Label>
                            <Input
                                inputMode="decimal"
                                value={form.markupPercent}
                                onChange={(e) => setForm((f) => ({ ...f, markupPercent: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Flat add (paise)</Label>
                            <Input
                                inputMode="numeric"
                                value={form.markupFlatPaise}
                                onChange={(e) => setForm((f) => ({ ...f, markupFlatPaise: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Rounding (paise) — 0 = exact, 100 = ₹1, 1000 = ₹10</Label>
                            <Input
                                inputMode="numeric"
                                value={form.roundingPaise}
                                onChange={(e) => setForm((f) => ({ ...f, roundingPaise: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Priority (higher wins)</Label>
                            <Input
                                inputMode="numeric"
                                value={form.priority}
                                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-sm pb-2 self-end">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                            />
                            Active
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" onClick={save} disabled={saving}>
                            Save
                        </Button>
                        <Button type="button" variant="outline" onClick={cancel}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead className="text-right">Markup %</TableHead>
                            <TableHead className="text-right">Flat</TableHead>
                            <TableHead>Rounding</TableHead>
                            <TableHead className="text-right">Priority</TableHead>
                            <TableHead className="text-right">Used by</TableHead>
                            <TableHead className="text-right"> </TableHead>
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
                                    <TableCell className="font-medium">
                                        {s.name}
                                        {!s.isActive ? (
                                            <Badge variant="outline" className="ml-2">
                                                inactive
                                            </Badge>
                                        ) : null}
                                    </TableCell>
                                    <TableCell>{SCOPE_LABEL[s.scope]}</TableCell>
                                    <TableCell>{scopeIdLabelOf(s)}</TableCell>
                                    <TableCell className="text-right">{Number(s.markupPercent).toFixed(2)}%</TableCell>
                                    <TableCell className="text-right">{formatPaise(s.markupFlatPaise)}</TableCell>
                                    <TableCell>{formatRounding(s.roundingPaise)}</TableCell>
                                    <TableCell className="text-right">{s.priority}</TableCell>
                                    <TableCell className="text-right">
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
                                    <TableCell className="text-right space-x-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Edit"
                                            onClick={() => beginEdit(s)}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Delete"
                                            onClick={() => del(s.id)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
