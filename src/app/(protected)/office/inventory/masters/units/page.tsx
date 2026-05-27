"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDeleteWithConfirm } from "@/shared/hooks";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

type InvUnit = {
    id: number;
    code: string;
    label: string;
    decimals: number;
    isActive: boolean;
};

const empty = { code: "", label: "", decimals: "0", isActive: true };

export default function InventoryUnitsPage() {
    const [rows, setRows] = useState<InvUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<InvUnit[]>("/api/inventory/units")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load units"))
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
        if (!form.label.trim()) {
            toast.error("Label is required");
            return;
        }
        if (adding && !form.code.trim()) {
            toast.error("Code is required");
            return;
        }
        setSaving(true);
        try {
            if (adding) {
                await axios.post("/api/inventory/units", {
                    code: form.code.trim(),
                    label: form.label.trim(),
                    decimals: parseInt(form.decimals, 10) || 0,
                    isActive: form.isActive,
                });
                toast.success("Unit created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/units/${editId}`, {
                    code: form.code.trim() || undefined,
                    label: form.label.trim(),
                    decimals: parseInt(form.decimals, 10) || 0,
                    isActive: form.isActive,
                });
                toast.success("Unit updated");
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
        url: (id) => `/api/inventory/units/${id}`,
        message: () => "Delete this unit?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Ruler className="size-5" aria-hidden />
                        Units
                    </h2>
                    <p className="text-muted-foreground text-sm">Codes are stored uppercase.</p>
                </div>
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New unit
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="flex-none space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New unit" : "Edit unit"}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Code</Label>
                            <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={adding ? false : editId == null} />
                        </div>
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Decimals</Label>
                            <Input inputMode="numeric" value={form.decimals} onChange={(e) => setForm((f) => ({ ...f, decimals: e.target.value }))} />
                        </div>
                        <div className="flex items-end gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                                Active
                            </label>
                        </div>
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

            <ScrollArea className="min-h-0 flex-1 border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Label</TableHead>
                            <TableHead className="text-right">Decimals</TableHead>
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
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                    No units yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((u) => (
                                <TableRow key={u.id}>
                                    <TableCell className="font-mono text-sm">{u.code}</TableCell>
                                    <TableCell>{u.label}</TableCell>
                                    <TableCell className="text-right">{u.decimals}</TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!u.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Edit"
                                            onClick={() => {
                                                setAdding(false);
                                                setEditId(u.id);
                                                setForm({
                                                    code: u.code,
                                                    label: u.label,
                                                    decimals: String(u.decimals),
                                                    isActive: u.isActive,
                                                });
                                            }}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(u.id)}>
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
        </div>
    );
}
