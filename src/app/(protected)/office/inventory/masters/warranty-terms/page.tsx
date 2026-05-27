"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type Row = {
    id: number;
    name: string;
    description: string | null;
    durationDays: number | null;
    isActive: boolean;
};

const empty = { name: "", description: "", durationDays: "", isActive: true };

/// Display a day count as "Nd" / "Nm" / "Ny" depending on what divides cleanly.
/// Examples: 7 → "7d", 30 → "1m", 90 → "3m", 365 → "1y", 1825 → "5y".
function formatDays(days: number | null): string {
    if (days == null || days === 0) return "—";
    if (days % 365 === 0) return `${days / 365}y`;
    if (days % 30 === 0) return `${days / 30}m`;
    return `${days}d`;
}

export default function InventoryWarrantyTermsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/warranty-terms")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load warranty terms"))
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
        const dd = form.durationDays.trim();
        const durationDays = dd === "" ? null : parseInt(dd, 10);
        if (durationDays != null && (!Number.isFinite(durationDays) || durationDays < 0)) {
            toast.error("Duration days must be a non-negative number");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() === "" ? null : form.description.trim(),
                durationDays,
                isActive: form.isActive,
            };
            if (adding) {
                await axios.post("/api/inventory/warranty-terms", payload);
                toast.success("Warranty term created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/warranty-terms/${editId}`, payload);
                toast.success("Warranty term updated");
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
        url: (id) => `/api/inventory/warranty-terms/${id}`,
        message: () => "Delete this warranty term?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <ShieldCheck className="size-5" aria-hidden />
                    Warranty terms
                </h2>
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New term
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="flex-none space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New warranty term" : "Edit warranty term"}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Description</Label>
                            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
                        </div>
                        <div className="space-y-2">
                            <Label>Duration (days)</Label>
                            <Input
                                inputMode="numeric"
                                placeholder="e.g. 7, 30, 365, 1825"
                                value={form.durationDays}
                                onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
                            />
                            <p className="text-xs text-muted-foreground">
                                Days from sale. Leave blank for lifetime / no-warranty / testing-only terms.
                            </p>
                        </div>
                        <div className="flex items-end">
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
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={3} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="text-muted-foreground">
                                    No warranty terms yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">{r.name}</TableCell>
                                    <TableCell className="text-right text-muted-foreground text-sm">
                                        {formatDays(r.durationDays)}
                                        {r.durationDays != null && r.durationDays > 0 ? (
                                            <span className="ml-1 text-xs opacity-70">({r.durationDays}d)</span>
                                        ) : null}
                                    </TableCell>
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
                                                setForm({
                                                    name: r.name,
                                                    description: r.description ?? "",
                                                    durationDays: r.durationDays == null ? "" : String(r.durationDays),
                                                    isActive: r.isActive,
                                                });
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
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
}
