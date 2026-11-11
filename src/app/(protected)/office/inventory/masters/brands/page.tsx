"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";
import { useApiResource, useDeleteWithConfirm, useListSearch } from "@/shared/hooks";
import { ListSearchInput } from "@/shared/components/ListSearchInput";

type Row = { id: number; name: string; isActive: boolean };
const empty = { name: "", isActive: true };

export default function InventoryBrandsPage() {
    // Spike for the masters template: the list, its first-load spinner and the
    // post-save refetch come from the shared hook. `reload()` keeps the rows on
    // screen while it re-fetches, so a save no longer flashes the table blank.
    const { data: rows = [], loading, error, reload } = useApiResource<Row[]>("/api/inventory/brands", { topics: ["catalogue"] });
    const { query, setQuery, filtered } = useListSearch(rows, (r) => r.name);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

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
            if (adding) {
                await axios.post("/api/inventory/brands", { name: form.name.trim(), isActive: form.isActive });
                toast.success("Brand created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/brands/${editId}`, { name: form.name.trim(), isActive: form.isActive });
                toast.success("Brand updated");
            }
            cancel();
            reload();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    const { remove: del } = useDeleteWithConfirm({
        url: (id) => `/api/inventory/brands/${id}`,
        message: () => "Delete this brand?",
        errorMessage: "Delete failed",
        onSuccess: reload,
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <Tag className="size-5" aria-hidden />
                    Brands
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                <ListSearchInput value={query} onChange={setQuery} placeholder="Search brands…" />
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New brand
                </Button>
                </div>
            </div>

            {adding || editId != null ? (
                <div className="flex-none space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New brand" : "Edit brand"}</p>
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-2 min-w-[200px]">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>
                        <label className="flex items-center gap-2 text-sm pb-2">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
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

            <div className="min-h-0 flex-1 overflow-auto border border-border [&_[data-slot=table-container]]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={2} />
                        ) : rows.length === 0 ? (
                            <TableEmptyRow colSpan={2} message={error ? `Failed to load brands: ${error}` : "No brands yet."} />
                        ) : filtered.length === 0 ? (
                            <TableEmptyRow colSpan={2} message={`No brands match "${query.trim()}".`} />
                        ) : (
                            filtered.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">{r.name}</TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!r.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Edit"
                                            onClick={() => {
                                                setAdding(false);
                                                setEditId(r.id);
                                                setForm({ name: r.name, isActive: r.isActive });
                                            }}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(r.id)}>
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
