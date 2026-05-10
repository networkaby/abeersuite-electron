"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, LayoutGrid } from "lucide-react";
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

type Row = { id: number; name: string; isActive: boolean };
const empty = { name: "", isActive: true };

export default function InventoryProductGroupsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/product-groups")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load groups"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

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
                await axios.post("/api/inventory/product-groups", { name: form.name.trim(), isActive: form.isActive });
                toast.success("Group created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/product-groups/${editId}`, { name: form.name.trim(), isActive: form.isActive });
                toast.success("Group updated");
            }
            cancel();
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const del = async (id: number) => {
        if (!confirm("Delete this group?")) return;
        try {
            await axios.delete(`/api/inventory/product-groups/${id}`);
            toast.success("Deleted");
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Delete failed");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <LayoutGrid className="size-5" aria-hidden />
                    Product groups
                </h2>
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New group
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New group" : "Edit group"}</p>
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

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={2} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={2} className="text-muted-foreground">
                                    No groups yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((r) => (
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
