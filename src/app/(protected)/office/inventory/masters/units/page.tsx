"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
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

type InvUnit = {
    id: number;
    code: string;
    label: string;
    decimals: number;
    isActive: boolean;
    /** null = this IS a base unit. Set = compound ("Dozen of 12 Nos"). */
    baseUnitId: number | null;
    conversionFactor: number | null;
    baseUnit: { id: number; code: string; label: string } | null;
};

const empty = {
    code: "", label: "", decimals: "0", isActive: true,
    baseUnitId: "", conversionFactor: "",
};

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

    useRealtimeTopics(["catalogue"], load);

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
        // Compound is all-or-nothing: a base unit without a factor (or the
        // reverse) has no readable meaning.
        const baseUnitId = form.baseUnitId ? parseInt(form.baseUnitId, 10) : null;
        const conversionFactor = form.conversionFactor.trim()
            ? parseInt(form.conversionFactor, 10)
            : null;
        if ((baseUnitId == null) !== (conversionFactor == null)) {
            toast.error("A compound unit needs both a base unit and a conversion factor");
            return;
        }
        if (conversionFactor != null && conversionFactor < 2) {
            toast.error("Conversion factor must be 2 or more");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                label: form.label.trim(),
                decimals: parseInt(form.decimals, 10) || 0,
                isActive: form.isActive,
                baseUnitId,
                conversionFactor,
            };
            if (adding) {
                await axios.post("/api/inventory/units", { ...payload, code: form.code.trim() });
                toast.success("Unit created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/units/${editId}`, {
                    ...payload,
                    code: form.code.trim() || undefined,
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
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
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

                    {/* Compound unit — "Dozen of 12 Nos". Stock is always STORED in
                        the base unit; this only changes how it is displayed. */}
                    <div className="space-y-2 border-t border-border pt-3">
                        <p className="text-sm font-medium">Compound unit <span className="font-normal text-muted-foreground">(optional)</span></p>
                        <p className="text-xs text-muted-foreground">
                            Leave blank for a base unit. Otherwise name the <strong>immediate</strong> parent and how many of it
                            this unit holds — <span className="font-mono">1 KM = 1000 M</span>, <span className="font-mono">1 M = 100 CM</span>.
                            Chains are fine: the parent may itself be a compound unit. Stock is always stored in the
                            chain’s smallest unit, so 1,015,005 CM shows as “10 KM 150 M 5 CM”.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Base unit</Label>
                                <select
                                    className="border-input bg-background h-9 w-full border px-2 text-sm"
                                    value={form.baseUnitId}
                                    onChange={(e) => setForm((f) => ({ ...f, baseUnitId: e.target.value }))}
                                >
                                    <option value="">— none (this is a base unit) —</option>
                                    {/* Any unit may be a parent — chains are allowed
                                        (KM → M → CM). Only self is excluded here;
                                        loops and depth are refused server-side. */}
                                    {rows
                                        .filter((u) => u.id !== editId)
                                        .map((u) => (
                                            <option key={u.id} value={String(u.id)}>
                                                {u.code} — {u.label}
                                                {u.baseUnit && u.conversionFactor ? ` (= ${u.conversionFactor} ${u.baseUnit.code})` : ""}
                                            </option>
                                        ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label>Base units per {form.code.trim().toUpperCase() || "unit"}</Label>
                                <Input
                                    inputMode="numeric"
                                    placeholder="e.g. 12"
                                    value={form.conversionFactor}
                                    onChange={(e) => setForm((f) => ({ ...f, conversionFactor: e.target.value }))}
                                />
                            </div>
                        </div>
                        {!adding ? (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                                Changing the conversion is blocked while products on this unit still hold stock —
                                it would re-read their existing quantities.
                            </p>
                        ) : null}
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
                            <TableHead>Code</TableHead>
                            <TableHead>Label</TableHead>
                            <TableHead>Conversion</TableHead>
                            <TableHead className="text-right">Decimals</TableHead>
                            <TableHead> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-muted-foreground">
                                    No units yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((u) => (
                                <TableRow key={u.id}>
                                    <TableCell className="font-mono text-sm">{u.code}</TableCell>
                                    <TableCell>{u.label}</TableCell>
                                    <TableCell className="text-sm">
                                        {u.baseUnit && u.conversionFactor ? (
                                            <span className="font-mono">1 {u.code} = {u.conversionFactor} {u.baseUnit.code}</span>
                                        ) : (
                                            <span className="text-muted-foreground">base unit</span>
                                        )}
                                    </TableCell>
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
                                                    baseUnitId: u.baseUnitId != null ? String(u.baseUnitId) : "",
                                                    conversionFactor: u.conversionFactor != null ? String(u.conversionFactor) : "",
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
            </div>
        </div>
    );
}
