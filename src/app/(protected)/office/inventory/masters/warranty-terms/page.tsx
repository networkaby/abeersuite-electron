"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { NumericInput } from "@/shared/components/NumericInput";
import { useDeleteWithConfirm, useListSearch } from "@/shared/hooks";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { ListSearchInput } from "@/shared/components/ListSearchInput";
import {
    checkWarrantyShape,
    formatWarrantyDaysLong,
    isWarrantyType,
    WARRANTY_TYPE_LABEL,
    WARRANTY_TYPES,
    warrantyTermLabel,
    type WarrantyTypeValue,
} from "@/shared/lib/warranty/warrantyTerms";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type Row = {
    id: number;
    name: string;
    description: string | null;
    durationDays: number | null;
    warrantyType: WarrantyTypeValue;
    sellerDays: number | null;
    extraCondition: string | null;
    isActive: boolean;
    /** Sale lines that froze this term — its printed part is locked when > 0. */
    usedOnBills: number;
};

type Form = {
    name: string;
    description: string;
    warrantyType: WarrantyTypeValue;
    durationDays: string;
    sellerDays: string;
    extraCondition: string;
    isActive: boolean;
};

const empty: Form = {
    name: "", description: "", warrantyType: "MANUFACTURER", durationDays: "", sellerDays: "", extraCondition: "", isActive: true,
};

const TYPE_HINT: Record<WarrantyTypeValue, string> = {
    SELLER:       "The shop handles the claim.",
    MANUFACTURER: "The brand's service centre handles the claim.",
    COMBINED:     "The brand for the whole period, plus our own warranty for the seller period (customer may go to either).",
    NONE:         "Printed as \"No warranty\" on the bill.",
};

const toDays = (s: string): number | null => (s.trim() === "" ? null : parseInt(s, 10));

export default function InventoryWarrantyTermsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const { query, setQuery, filtered } = useListSearch(rows, (r) => `${r.name} ${r.description ?? ""} ${WARRANTY_TYPE_LABEL[r.warrantyType] ?? ""}`);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<Form>(empty);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/warranty-terms")
            .then((r) => setRows(r.data.map((t) => ({ ...t, warrantyType: isWarrantyType(t.warrantyType) ? t.warrantyType : "MANUFACTURER" }))))
            .catch(() => toast.error("Failed to load warranty terms"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    useRealtimeTopics(["catalogue"], load);

    const editing = editId != null ? rows.find((r) => r.id === editId) ?? null : null;
    // A term on any bill keeps its printed part — those bills reprint from it.
    const locked = (editing?.usedOnBills ?? 0) > 0;

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
        const shape = checkWarrantyShape({
            warrantyType: form.warrantyType,
            durationDays: toDays(form.durationDays),
            sellerDays:   toDays(form.sellerDays),
        });
        if ("error" in shape) {
            toast.error(shape.error);
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() === "" ? null : form.description.trim(),
                isActive: form.isActive,
                // A used term sends only what it may still change.
                ...(locked ? {} : {
                    ...shape.value,
                    extraCondition: form.extraCondition.trim() === "" ? null : form.extraCondition.trim(),
                }),
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

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
    const t = form.warrantyType;

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <ShieldCheck className="size-5" aria-hidden />
                    Warranty terms
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                <ListSearchInput value={query} onChange={setQuery} placeholder="Search warranty terms…" />
                <Button type="button" onClick={() => { setForm(empty); setEditId(null); setAdding(true); }} disabled={adding}>
                    <Plus className="size-4" />
                    New term
                </Button>
                </div>
            </div>

            {adding || editId != null ? (
                // Compact: two rows on a wide screen, so the list stays in view.
                <div className="flex-none space-y-2 border-2 border-border bg-muted/30 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-sm font-semibold">{adding ? "New warranty term" : "Edit warranty term"}</p>
                        {locked ? (
                            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                <Lock className="size-3.5 shrink-0" aria-hidden />
                                On {editing?.usedOnBills} bill line{editing?.usedOnBills === 1 ? "" : "s"}: type, days and extra condition are locked. Create a new term for a new policy.
                            </span>
                        ) : null}
                        <div className="ml-auto flex gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={cancel}>
                                Cancel
                            </Button>
                            <Button type="button" size="sm" onClick={save} disabled={saving}>
                                Save
                            </Button>
                        </div>
                    </div>

                    <div className="grid gap-x-3 gap-y-2 lg:grid-cols-12">
                        <div className="space-y-1 lg:col-span-3">
                            <Label className="text-xs">Name</Label>
                            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
                        </div>
                        <div className="space-y-1 lg:col-span-7">
                            <Label className="text-xs">Warranty type</Label>
                            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Warranty type">
                                {WARRANTY_TYPES.map((wt) => (
                                    <Button
                                        key={wt}
                                        type="button"
                                        size="sm"
                                        role="radio"
                                        aria-checked={t === wt}
                                        variant={t === wt ? "default" : "outline"}
                                        disabled={locked}
                                        onClick={() => set("warrantyType", wt)}
                                    >
                                        {WARRANTY_TYPE_LABEL[wt]}
                                    </Button>
                                ))}
                                <span className="text-xs text-muted-foreground">{TYPE_HINT[t]}</span>
                            </div>
                        </div>
                        <label className="flex items-center gap-2 self-end pb-2 text-sm lg:col-span-2 lg:justify-end">
                            <Checkbox checked={form.isActive} onCheckedChange={(v) => set("isActive", v === true)} />
                            Active
                        </label>

                        {t === "COMBINED" ? (
                            <div className="space-y-1 lg:col-span-2">
                                <Label className="text-xs">Seller period (days)</Label>
                                <NumericInput
                                    mode="digits"
                                    min={1}
                                    max={36500}
                                    placeholder="365"
                                    value={form.sellerDays}
                                    onValueChange={(v) => set("sellerDays", v)}
                                    disabled={locked}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    {form.sellerDays ? `Our own · ${formatWarrantyDaysLong(toDays(form.sellerDays))}` : "Our own, on top"}
                                </p>
                            </div>
                        ) : null}
                        {t !== "NONE" ? (
                            <div className={`space-y-1 ${t === "COMBINED" ? "lg:col-span-2" : "lg:col-span-3"}`}>
                                <Label className="text-xs">{t === "COMBINED" ? "Manufacturer period (days)" : "Duration (days)"}</Label>
                                <NumericInput
                                    mode="digits"
                                    min={0}
                                    max={36500}
                                    placeholder="e.g. 7, 30, 365, 1825"
                                    value={form.durationDays}
                                    onValueChange={(v) => set("durationDays", v)}
                                    disabled={locked}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    {form.durationDays && toDays(form.durationDays)
                                        ? `${formatWarrantyDaysLong(toDays(form.durationDays))} from sale`
                                        : "Blank = lifetime"}
                                </p>
                            </div>
                        ) : null}
                        <div className={`space-y-1 ${t === "NONE" ? "lg:col-span-6" : t === "COMBINED" ? "lg:col-span-4" : "lg:col-span-5"}`}>
                            <Label className="text-xs">Extra condition (optional)</Label>
                            <Input
                                value={form.extraCondition}
                                onChange={(e) => set("extraCondition", e.target.value)}
                                disabled={locked}
                                placeholder="Printed after the type's condition (Settings → Print templates)"
                            />
                        </div>
                        <div className={`space-y-1 ${t === "NONE" ? "lg:col-span-6" : "lg:col-span-4"}`}>
                            <Label className="text-xs">Description (internal)</Label>
                            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="min-h-48 flex-1 overflow-auto border border-border [&_[data-slot=table-container]]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                            <TableHead className="text-right"> </TableHead>
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
                                    No warranty terms yet.
                                </TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableEmptyRow colSpan={4} message={`No warranty terms match "${query.trim()}".`} />
                        ) : (
                            filtered.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">
                                        {r.name}
                                        {r.extraCondition ? (
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">+ {r.extraCondition}</span>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {WARRANTY_TYPE_LABEL[r.warrantyType]}
                                        {r.usedOnBills > 0 ? (
                                            <Lock className="ml-1.5 inline size-3 text-muted-foreground" aria-label="Used on bills" />
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground text-sm">
                                        {r.warrantyType === "NONE" ? "—" : warrantyTermLabel(r)}
                                        {r.durationDays != null && r.durationDays > 0 && r.warrantyType !== "NONE" ? (
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
                                                    warrantyType: r.warrantyType,
                                                    durationDays: r.durationDays == null ? "" : String(r.durationDays),
                                                    sellerDays: r.sellerDays == null ? "" : String(r.sellerDays),
                                                    extraCondition: r.extraCondition ?? "",
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
            </div>
        </div>
    );
}
