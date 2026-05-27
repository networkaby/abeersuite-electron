"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { InvProductPicker } from "@/modules/inventory/components/InvProductPicker";

type LineForm = { productId: number; qty: string };

type Row = {
    id:              number;
    name:            string;
    description:     string | null;
    outputProductId: number;
    outputQty:       string;
    isActive:        boolean;
    outputProduct:   { id: number; sku: string; name: string; unit: { code: string } } | null;
    lines:           {
        id: number;
        productId: number;
        qty: string;
        product: { id: number; sku: string; name: string; unit: { code: string } };
    }[];
};

const emptyForm = {
    name:            "",
    description:     "",
    outputProductId: 0,
    outputQty:       "1",
    isActive:        true,
    lines:           [{ productId: 0, qty: "1" }] as LineForm[],
};

export default function InventoryBomsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const load = () => {
        setLoading(true);
        axios
            .get<Row[]>("/api/inventory/boms")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load BOMs"))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(emptyForm);
    };

    const startEdit = (r: Row) => {
        setAdding(false);
        setEditId(r.id);
        setForm({
            name:            r.name,
            description:     r.description ?? "",
            outputProductId: r.outputProductId,
            outputQty:       String(r.outputQty),
            isActive:        r.isActive,
            lines:           r.lines.length > 0
                ? r.lines.map((l) => ({ productId: l.productId, qty: String(l.qty) }))
                : [{ productId: 0, qty: "1" }],
        });
    };

    const updateLine = (i: number, patch: Partial<LineForm>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    const addLine    = () => setForm((f) => ({ ...f, lines: [...f.lines, { productId: 0, qty: "1" }] }));
    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const save = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (!form.outputProductId) { toast.error("Output product is required"); return; }
        const outQty = parseFloat(form.outputQty);
        if (!(outQty > 0)) { toast.error("Output qty must be > 0"); return; }
        const lines = form.lines
            .map((l) => ({ productId: l.productId, qty: parseFloat(l.qty) || 0 }))
            .filter((l) => l.productId > 0 && l.qty > 0);
        if (lines.length === 0) { toast.error("At least one consumption line is required"); return; }

        setSaving(true);
        try {
            const payload = {
                name:            form.name.trim(),
                description:     form.description.trim() || null,
                outputProductId: form.outputProductId,
                outputQty:       outQty,
                isActive:        form.isActive,
                lines,
            };
            if (adding) {
                await axios.post("/api/inventory/boms", payload);
                toast.success("BOM created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/boms/${editId}`, payload);
                toast.success("BOM updated");
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
        url: (id) => `/api/inventory/boms/${id}`,
        message: () => "Delete this BOM? It will be removed permanently. (Used BOMs can't be deleted — deactivate instead.)",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Workflow className="size-5" aria-hidden />
                        Bill of Materials
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Recipes that the Manufacturing Journal can auto-fill from — define the output product and the
                        consumption line items. The journal scales consumption proportionally when you change the target output qty.
                    </p>
                </div>
                <Button type="button" onClick={() => { setForm(emptyForm); setEditId(null); setAdding(true); }} disabled={adding || editId != null}>
                    <Plus className="size-4" />
                    New BOM
                </Button>
            </div>

            {(adding || editId != null) && (
                <div className="flex-none space-y-4 border-2 border-border bg-muted/30 p-4 rounded-lg">
                    <p className="text-sm font-semibold">{adding ? "New BOM" : "Edit BOM"}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Name *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="e.g. Assembled PC (basic config)"
                            />
                        </div>
                        <label className="flex items-end gap-2 text-sm pb-2">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                            Active (available in Manufacturing Journal picker)
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <InvProductPicker
                                label="Output product *"
                                value={form.outputProductId || null}
                                onChange={(id) => setForm((f) => ({ ...f, outputProductId: id ?? 0 }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Output qty *</Label>
                            <Input
                                value={form.outputQty}
                                onChange={(e) => setForm((f) => ({ ...f, outputQty: e.target.value }))}
                                placeholder="1"
                            />
                            <p className="text-[11px] text-muted-foreground">Reference qty — consumption is scaled proportionally on the journal.</p>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Textarea
                            rows={2}
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Optional notes about this recipe"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>Consumption lines *</Label>
                            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-sm" onClick={addLine}>
                                + Add line
                            </Button>
                        </div>
                        <div className="overflow-x-auto rounded border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Material</th>
                                        <th className="px-3 py-2 text-right font-medium w-28">Qty</th>
                                        <th className="px-3 py-2 w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.lines.map((line, i) => (
                                        <tr key={i} className="border-t border-border">
                                            <td className="px-3 py-2 min-w-[260px]">
                                                <InvProductPicker
                                                    label=""
                                                    value={line.productId || null}
                                                    onChange={(id) => updateLine(i, { productId: id ?? 0 })}
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.qty}
                                                    onChange={(e) => updateLine(i, { qty: e.target.value })}
                                                    className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-right"
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {form.lines.length > 1 && (
                                                    <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                                        <X size={14} />
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                        <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
                    </div>
                </div>
            )}

            <ScrollArea className="min-h-0 flex-1 border border-border rounded">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Output</TableHead>
                            <TableHead className="text-right">Output qty</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={5} />
                        ) : rows.length === 0 ? (
                            <TableEmptyRow colSpan={5} message="No BOMs yet — create one to enable BOM-driven manufacturing journals." />
                        ) : (
                            rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">
                                        {r.name}
                                        {!r.isActive && <Badge variant="outline" className="ml-2">inactive</Badge>}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {r.outputProduct ? (
                                            <span>
                                                <span className="font-mono text-xs">{r.outputProduct.sku}</span>{" "}
                                                {r.outputProduct.name}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">{Number(r.outputQty)}</TableCell>
                                    <TableCell className="text-right">{r.lines.length}</TableCell>
                                    <TableCell className="text-right space-x-2">
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => startEdit(r)}>
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
