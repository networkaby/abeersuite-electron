"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDeleteWithConfirm } from "@/shared/hooks";
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

type GstRateOpt = { id: number; rate: string | number; label: string; isActive: boolean };

type Row = {
    id: number;
    name: string;
    isActive: boolean;
    parentId: number | null;
    parent: { id: number; name: string } | null;
    gstRateId: number | null;
    gstRate: { id: number; rate: string | number; label: string } | null;
    hsnCode: string | null;
    taxability: string | null;
};

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE",   label: "Taxable" },
    { value: "EXEMPT",    label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST",   label: "Non-GST" },
];

const emptyForm = {
    name: "",
    isActive: true,
    parentId: "",
    gstRateId: "",
    hsnCode: "",
    taxability: "",
};

const NONE = "__none__";

export default function InventoryProductGroupsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [gstRates, setGstRates] = useState<GstRateOpt[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(emptyForm);
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
        axios
            .get<GstRateOpt[]>("/api/inventory/gst-rates")
            .then((r) => setGstRates(r.data))
            .catch(() => {/* non-fatal */});
    }, []);

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
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                isActive: form.isActive,
                parentId:   form.parentId   !== "" && form.parentId !== NONE ? Number(form.parentId) : null,
                gstRateId:  form.gstRateId  !== "" && form.gstRateId !== NONE ? Number(form.gstRateId) : null,
                hsnCode:    form.hsnCode.trim() || null,
                taxability: form.taxability !== "" && form.taxability !== NONE ? form.taxability : null,
            };
            if (adding) {
                await axios.post("/api/inventory/product-groups", payload);
                toast.success("Group created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/product-groups/${editId}`, payload);
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

    const { remove: del } = useDeleteWithConfirm({
        url: (id) => `/api/inventory/product-groups/${id}`,
        message: () => "Delete this group?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    // Groups eligible as parent: all except the current group being edited (to avoid self-ref).
    const parentOptions = rows.filter((r) => r.id !== editId);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <LayoutGrid className="size-5" aria-hidden />
                    Product groups
                </h2>
                <Button type="button" onClick={() => { setForm(emptyForm); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New group
                </Button>
            </div>

            {adding || editId != null ? (
                <div className="space-y-4 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New group" : "Edit group"}</p>

                    <div className="grid gap-4 sm:grid-cols-2">
                        {/* Name */}
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>

                        {/* Parent group */}
                        <div className="space-y-2">
                            <Label>Parent group</Label>
                            <Select
                                value={form.parentId || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, parentId: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="None (top-level)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>None (top-level)</SelectItem>
                                    {parentOptions.map((g) => (
                                        <SelectItem key={g.id} value={String(g.id)}>
                                            {g.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">GST / HSN set here is inherited by child groups and their products.</p>
                        </div>

                        {/* GST rate */}
                        <div className="space-y-2">
                            <Label>GST rate</Label>
                            <Select
                                value={form.gstRateId || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, gstRateId: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="— inherit —" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— inherit —</SelectItem>
                                    {gstRates.filter((r) => r.isActive).map((r) => (
                                        <SelectItem key={r.id} value={String(r.id)}>
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* HSN code */}
                        <div className="space-y-2">
                            <Label>HSN / SAC code</Label>
                            <Input
                                value={form.hsnCode}
                                onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value }))}
                                placeholder="Leave empty to inherit"
                                maxLength={32}
                            />
                        </div>

                        {/* Taxability */}
                        <div className="space-y-2">
                            <Label>Taxability</Label>
                            <Select
                                value={form.taxability || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, taxability: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="— inherit —" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— inherit —</SelectItem>
                                    {TAXABILITY_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Active */}
                        <div className="sm:col-span-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                                Active
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                        <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
                    </div>
                </div>
            ) : null}

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Parent</TableHead>
                            <TableHead>GST</TableHead>
                            <TableHead>HSN</TableHead>
                            <TableHead>Taxability</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">No groups yet.</TableCell>
                            </TableRow>
                        ) : (
                            rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">{r.name}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{r.parent?.name ?? <span className="italic">—</span>}</TableCell>
                                    <TableCell className="text-sm">{r.gstRate ? r.gstRate.label : <span className="italic text-muted-foreground">inherit</span>}</TableCell>
                                    <TableCell className="font-mono text-sm">{r.hsnCode ?? <span className="italic text-muted-foreground">inherit</span>}</TableCell>
                                    <TableCell className="text-sm">{r.taxability ?? <span className="italic text-muted-foreground">inherit</span>}</TableCell>
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
                                                    isActive: r.isActive,
                                                    parentId:   r.parentId  != null ? String(r.parentId)  : "",
                                                    gstRateId:  r.gstRateId != null ? String(r.gstRateId) : "",
                                                    hsnCode:    r.hsnCode  ?? "",
                                                    taxability: r.taxability ?? "",
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
            </div>
        </div>
    );
}
