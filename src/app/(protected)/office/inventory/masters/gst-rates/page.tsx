"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Percent } from "lucide-react";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";
import { useDeleteWithConfirm } from "@/shared/hooks";

type Row = { id: number; rate: string; label: string; description: string | null; isActive: boolean };

const empty = { rate: "", label: "", description: "", isActive: true };

export default function GstRatesPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/gst-rates")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load GST rates"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const cancel = () => { setAdding(false); setEditId(null); setForm(empty); };

    const save = async () => {
        const rateNum = parseFloat(form.rate);
        if (!form.label.trim()) { toast.error("Label is required"); return; }
        if (!form.rate.trim() || !Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
            toast.error("Rate must be a number between 0 and 100");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                rate: rateNum,
                label: form.label.trim(),
                description: form.description.trim() || null,
                isActive: form.isActive,
            };
            if (adding) {
                await axios.post("/api/inventory/gst-rates", payload);
                toast.success("GST rate created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/gst-rates/${editId}`, payload);
                toast.success("GST rate updated");
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
        url: (id) => `/api/inventory/gst-rates/${id}`,
        message: () => "Delete this GST rate?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <Percent className="size-5" aria-hidden />
                    GST Rates
                </h2>
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New rate
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New GST rate" : "Edit GST rate"}</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label>Rate (%)</Label>
                            <Input
                                type="text"
                                placeholder="e.g. 18"
                                value={form.rate}
                                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input
                                placeholder="e.g. GST 18%"
                                value={form.label}
                                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Input
                                placeholder="Optional note"
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            />
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                        Active
                    </label>
                    <div className="flex gap-2">
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                        <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
                    </div>
                </div>
            ) : null}

            <ScrollArea className="min-h-0 flex-1 border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-24">Rate (%)</TableHead>
                            <TableHead>Label</TableHead>
                            <TableHead className="hidden sm:table-cell">Description</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={4} />
                        ) : rows.length === 0 ? (
                            <TableEmptyRow colSpan={4} message="No GST rates yet." />
                        ) : (
                            rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-mono">{Number(r.rate).toFixed(2)}%</TableCell>
                                    <TableCell className="font-medium">{r.label}</TableCell>
                                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{r.description ?? "—"}</TableCell>
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
                                                    rate: String(Number(r.rate)),
                                                    label: r.label,
                                                    description: r.description ?? "",
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
