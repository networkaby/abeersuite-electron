"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Layers, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDeleteWithConfirm, useListSearch, useSessionScroll } from "@/shared/hooks";
import { ListSearchInput } from "@/shared/components/ListSearchInput";
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
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { flattenTree, treeItemTotals, treeLabel } from "@/shared/lib/tree";
import { useCollapsibleTree } from "@/modules/inventory/hooks";
import { TreeItemsLink } from "@/modules/inventory/components/TreeItemsLink";

type InvCategory = {
    id: number;
    name: string;
    slug: string | null;
    parentId: number | null;
    isActive: boolean;
    parent?: { id: number; name: string } | null;
    /** Movement-band overrides (days) — null = inherit parent → org default. */
    slowAfterDays: number | null;
    nonMovingAfterDays: number | null;
    deadAfterDays: number | null;
    /** Products whose main collection is this one (from the list API). */
    _count?: { products: number };
};

const empty = {
    name: "", slug: "", parentId: "", isActive: true,
    slowAfterDays: "", nonMovingAfterDays: "", deadAfterDays: "",
};

export default function InventoryCategoriesPage() {
    const [rows, setRows] = useState<InvCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<InvCategory[]>("/api/inventory/categories")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load collections"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    useRealtimeTopics(["catalogue"], load);

    // Items per collection (own + sub-collections); Back from a drill-down keeps the scroll.
    const itemTotals = treeItemTotals(rows);
    const { ref: scrollRef, onScroll } = useSessionScroll("collections:scroll", !loading && rows.length > 0);

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(empty);
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSaving(true);
        try {
            const parentId = form.parentId === "" || form.parentId === "__none__" ? null : parseInt(form.parentId, 10);
            const slugTrim = form.slug.trim();
            const payload = {
                name: form.name.trim(),
                slug: slugTrim === "" ? null : slugTrim,
                parentId: parentId != null && Number.isFinite(parentId) ? parentId : null,
                isActive: form.isActive,
                slowAfterDays:      form.slowAfterDays.trim()      !== "" ? Number(form.slowAfterDays)      : null,
                nonMovingAfterDays: form.nonMovingAfterDays.trim() !== "" ? Number(form.nonMovingAfterDays) : null,
                deadAfterDays:      form.deadAfterDays.trim()      !== "" ? Number(form.deadAfterDays)      : null,
            };
            if (adding) {
                await axios.post("/api/inventory/categories", payload);
                toast.success("Collection created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/categories/${editId}`, payload);
                toast.success("Collection updated");
            }
            cancel();
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const { remove: del } = useDeleteWithConfirm({
        url: (id) => `/api/inventory/categories/${id}`,
        message: () => "Delete this collection?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    const parentOptions = rows.filter((c) => c.id !== editId);

    // Collapsible hierarchy view: parent → child ordering (via flattenTree) with
    // per-node expand/collapse. Shared with the product-groups master page.
    const tree = useCollapsibleTree(rows);
    const { collapsed, toggle, expandAll, collapseAll } = tree;
    // While searching, show matches as a flat list (a parent may not match).
    const { query, setQuery, filtered, searching } = useListSearch(rows, (c) => `${c.name} ${c.slug ?? ""}`);
    const hasTree = tree.hasTree && !searching;
    const visible = searching ? filtered.map((row) => ({ row, depth: 0, hasChildren: false })) : tree.visible;

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Layers className="size-5" aria-hidden />
                        Collections
                    </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <ListSearchInput value={query} onChange={setQuery} placeholder="Search collections…" />
                    {hasTree ? (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={expandAll}>Expand all</Button>
                            <Button type="button" variant="outline" size="sm" onClick={collapseAll}>Collapse all</Button>
                        </>
                    ) : null}
                    <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                        <Plus className="size-4" />
                        New collection
                    </Button>
                </div>
            </div>

            <Dialog open={adding || editId != null} onOpenChange={(o) => { if (!o) cancel(); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{adding ? "New collection" : "Edit collection"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Slug (optional)</Label>
                            <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="url-segment" />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Parent</Label>
                            <Select
                                value={form.parentId === "" ? "__none__" : form.parentId}
                                onValueChange={(v) => setForm((f) => ({ ...f, parentId: v === "__none__" ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">None</SelectItem>
                                    {flattenTree(parentOptions).map((r) => (
                                        <SelectItem key={r.id} value={String(r.id)}>
                                            {treeLabel(r)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Movement bands (days since last sale)</Label>
                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    ["slowAfterDays", "Slow after"],
                                    ["nonMovingAfterDays", "Non-moving after"],
                                    ["deadAfterDays", "Dead after"],
                                ] as const).map(([key, label]) => (
                                    <div key={key} className="space-y-1">
                                        <span className="text-[11px] text-muted-foreground">{label}</span>
                                        <Input
                                            inputMode="numeric"
                                            placeholder="inherit"
                                            value={form[key]}
                                            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, "") }))}
                                        />
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Drives the Reorder / Stock Health classes (a product&apos;s group override wins first).
                                Blank = inherit parent collection → org default — e.g. consumables 15/45/90.
                            </p>
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                                Active
                            </label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={cancel}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={save} disabled={saving}>
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto border border-border [&_[data-slot=table-container]]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead className="text-right" title="Products whose main collection is this one, including sub-collections">Items</TableHead>
                            <TableHead> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                    {searching ? `No collections match "${query.trim()}".` : "No collections yet."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            visible.map(({ row: c, depth, hasChildren }) => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium" style={{ paddingLeft: `${12 + depth * 20}px` }}>
                                        <span className="flex items-center gap-1">
                                            {hasChildren ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(c.id)}
                                                    className="-ml-1 rounded p-0.5 hover:bg-muted"
                                                    aria-label={collapsed.has(c.id) ? "Expand" : "Collapse"}
                                                >
                                                    {collapsed.has(c.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                                </button>
                                            ) : depth > 0 ? (
                                                <span className="text-muted-foreground">└</span>
                                            ) : null}
                                            {c.name}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{c.slug ?? "—"}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        <TreeItemsLink rows={rows} totals={itemTotals} id={c.id} param="collections" />
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!c.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Edit"
                                            onClick={() => {
                                                setAdding(false);
                                                setEditId(c.id);
                                                setForm({
                                                    name: c.name,
                                                    slug: c.slug ?? "",
                                                    parentId: c.parentId == null ? "" : String(c.parentId),
                                                    isActive: c.isActive,
                                                    slowAfterDays:      c.slowAfterDays      != null ? String(c.slowAfterDays)      : "",
                                                    nonMovingAfterDays: c.nonMovingAfterDays != null ? String(c.nonMovingAfterDays) : "",
                                                    deadAfterDays:      c.deadAfterDays      != null ? String(c.deadAfterDays)      : "",
                                                });
                                            }}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(c.id)}>
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
