"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
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
import { flattenTree, treeLabel } from "@/modules/inventory/components/InventoryMasterDropdownQuickDialog";

type Group = { id: number; name: string };
type Row = {
    id: number;
    key: string;
    name: string;
    groupId: number | null;
    group: { id: number; name: string } | null;
    sortOrder: number;
    isActive: boolean;
};

const emptyForm = { key: "", name: "", groupId: "", sortOrder: "0", isActive: true };

export default function AttributeMastersPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/attribute-masters")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load attribute masters"))
            .finally(() => setLoading(false));
    };

    const loadGroups = useCallback(() => {
        axios.get<Group[]>("/api/inventory/product-groups")
            .then((r) => setGroups(r.data))
            .catch(() => {});
    }, []);

    useEffect(() => { loadGroups(); load(); }, [loadGroups]);

    // Attribute masters and the groups they hang off are catalogue config —
    // a master added on another machine should appear here without a reload.
    // The row editor keeps its own `form` state, so it is untouched.
    useRealtimeTopics(["catalogue"], () => { loadGroups(); load(); });

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(emptyForm);
    };

    const save = async () => {
        if (!form.key.trim()) { toast.error("Key is required"); return; }
        if (!form.name.trim()) { toast.error("Label is required"); return; }
        if (!/^[a-z][a-z0-9_]*$/.test(form.key.trim())) {
            toast.error("Key must be lowercase letters, digits, underscores (start with letter)");
            return;
        }
        const payload = {
            key:        form.key.trim(),
            name:       form.name.trim(),
            groupId: form.groupId && form.groupId !== "__none__" ? Number(form.groupId) : null,
            sortOrder:  Number(form.sortOrder) || 0,
            isActive:   form.isActive,
        };
        setSaving(true);
        try {
            if (adding) {
                await axios.post("/api/inventory/attribute-masters", payload);
                toast.success("Attribute created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/attribute-masters/${editId}`, payload);
                toast.success("Attribute updated");
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
        url: (id) => `/api/inventory/attribute-masters/${id}`,
        message: () => "Delete this attribute?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    const openAdd = () => {
        setEditId(null);
        setForm(emptyForm);
        setAdding(true);
    };

    const openEdit = (r: Row) => {
        setAdding(false);
        setEditId(r.id);
        setForm({
            key:       r.key,
            name:      r.name,
            groupId: r.groupId != null ? String(r.groupId) : "",
            sortOrder: String(r.sortOrder),
            isActive:  r.isActive,
        });
    };

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <ListChecks className="size-5" aria-hidden />
                    Attribute masters
                </h2>
                <Button type="button" onClick={openAdd} disabled={adding}>
                    <Plus className="size-4" />
                    New attribute
                </Button>
            </div>

            <p className="flex-none text-sm text-muted-foreground">
                Define the attribute keys used in product custom attributes (e.g. <code className="font-mono text-xs">ram</code>, <code className="font-mono text-xs">storage</code>, <code className="font-mono text-xs">os</code>).
                Optionally restrict an attribute to one group — the product form offers the product&apos;s group attributes plus global ones.
                The naming convention&apos;s <strong>Attributes</strong> token prints every attribute a product has.
            </p>

            {adding || editId != null ? (
                <div className="flex-none space-y-3 border-2 border-border bg-muted/30 p-4">
                    <p className="text-sm font-semibold">{adding ? "New attribute" : "Edit attribute"}</p>
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-2 min-w-[140px]">
                            <Label>
                                Key <span className="text-[10px] text-muted-foreground font-normal">(machine, e.g. ram)</span>
                            </Label>
                            <Input
                                className="font-mono text-sm"
                                value={form.key}
                                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase() }))}
                                placeholder="ram"
                                disabled={editId != null}
                            />
                        </div>
                        <div className="space-y-2 min-w-[180px]">
                            <Label>
                                Label <span className="text-[10px] text-muted-foreground font-normal">(display, e.g. RAM)</span>
                            </Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="RAM"
                            />
                        </div>
                        <div className="space-y-2 min-w-[180px]">
                            <Label>Group <span className="text-[10px] text-muted-foreground font-normal">(optional)</span></Label>
                            <Select
                                value={form.groupId || "__none__"}
                                onValueChange={(v) => setForm((f) => ({ ...f, groupId: v === "__none__" ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="All groups" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">All groups (global)</SelectItem>
                                    {flattenTree(groups).map((r) => (
                                        <SelectItem key={r.id} value={String(r.id)}>{treeLabel(r)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 w-20">
                            <Label>Order</Label>
                            <Input
                                type="text" inputMode="numeric"
                                value={form.sortOrder}
                                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-sm pb-2">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                            Active
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                        <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
                    </div>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto border border-border [&_[data-slot=table-container]]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead>Key</TableHead>
                            <TableHead>Label</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={4} />
                        ) : rows.length === 0 ? (
                            <TableEmptyRow colSpan={4} message="No attributes yet." />
                        ) : (
                            rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                                    <TableCell className="font-medium">{r.name}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {r.group ? r.group.name : <em>Global</em>}
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!r.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => openEdit(r)}>
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
