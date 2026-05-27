"use client";

// Inline quick-add dialog for inventory master records. One component, five
// kinds: category, brand, group, warranty, unit. Each kind exposes the
// fields its schema actually has — name + isActive for trivial ones, full
// tax/parent/HSN for groups, etc.
//
// The full editors at /office/inventory/masters/<kind> stay the canonical
// place for bulk admin; this dialog is for "I'm in the products page and
// just need to add one new brand" moments.
//
// Used by:
//   • products/page.tsx — column filter `+ New`, inline cell `+ New`,
//     bulk-apply bar `+ New`.
//   • InvProductDialog → InvProductFormFields — `+ New` next to each
//     master picker in the create/edit product form.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export type MasterKind = "category" | "brand" | "group" | "warranty" | "unit";

type Opt = { id: number; name?: string; code?: string; label?: string; parentId?: number | null };
type GstRateOpt = { id: number; rate: string | number; label: string; isActive?: boolean };

const KIND_META: Record<MasterKind, { title: string; endpoint: string }> = {
    category: { title: "New category", endpoint: "/api/inventory/categories" },
    brand:    { title: "New brand",    endpoint: "/api/inventory/brands" },
    group:    { title: "New group",    endpoint: "/api/inventory/product-groups" },
    warranty: { title: "New warranty term", endpoint: "/api/inventory/warranty-terms" },
    unit:     { title: "New unit",     endpoint: "/api/inventory/units" },
};

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE", label: "Taxable" },
    { value: "EXEMPT", label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST", label: "Non-GST" },
] as const;

function optLabel(o: Opt): string {
    if (o.name) return o.name;
    const composed = `${o.code ?? ""} ${o.label ?? ""}`.trim();
    return composed || `#${o.id}`;
}

/// Walk a parented list (category / group) depth-first and emit each row
/// with its own name + depth. Call sites format the visible label however
/// they like — the most common is one "-" per depth level so the tree
/// reads vertically:
///
///   grand father
///   -father
///   -father1
///   --son
///   --son1
///   grand father1
///   -father
///
/// Sort within siblings is alphabetical. Orphans (parentId points to a row
/// that isn't in the list — usually a deactivated parent) bubble to the
/// top at depth 0 so they're still pickable.
export function flattenTree(rows: Opt[]): { id: number; name: string; depth: number }[] {
    const byParent = new Map<number | null, Opt[]>();
    for (const r of rows) {
        const pid: number | null = r.parentId ?? null;
        const arr = byParent.get(pid) ?? [];
        arr.push(r);
        byParent.set(pid, arr);
    }
    const out: { id: number; name: string; depth: number }[] = [];
    const seen = new Set<number>();
    function walk(parent: number | null, depth: number) {
        const kids = (byParent.get(parent) ?? []).slice().sort((a, b) =>
            optLabel(a).localeCompare(optLabel(b)),
        );
        for (const k of kids) {
            if (seen.has(k.id)) continue;
            seen.add(k.id);
            out.push({ id: k.id, name: optLabel(k), depth });
            walk(k.id, depth + 1);
        }
    }
    walk(null, 0);
    for (const r of rows) {
        if (!seen.has(r.id)) out.push({ id: r.id, name: optLabel(r), depth: 0 });
    }
    return out;
}

/// Format helper that turns a `flattenTree` row into the indented label.
/// Centralised so every picker draws the tree the same way.
export function treeLabel(row: { name: string; depth: number }): string {
    return row.depth === 0 ? row.name : `${"-".repeat(row.depth)}${row.name}`;
}

export interface InventoryMasterDropdownQuickDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: MasterKind;
    /** Existing rows of the same kind — used as parent candidates (category/group). */
    siblings?: Opt[];
    /** GST rates for the Group kind. Ignored for other kinds. */
    gstRates?: GstRateOpt[];
    /** Called with the new row's id after a successful POST. Caller should refresh its master list. */
    onCreated: (id: number) => void | Promise<void>;
}

export function InventoryMasterDropdownQuickDialog({
    open, onOpenChange, kind, siblings, gstRates, onCreated,
}: InventoryMasterDropdownQuickDialogProps) {
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [decimals, setDecimals] = useState("0");
    const [description, setDescription] = useState("");
    const [durationDays, setDurationDays] = useState("");
    const [parentId, setParentId] = useState("");
    const [gstRateId, setGstRateId] = useState("");
    const [hsnCode, setHsnCode] = useState("");
    const [taxability, setTaxability] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName("");
        setCode("");
        setDecimals("0");
        setDescription("");
        setDurationDays("");
        setParentId("");
        setGstRateId("");
        setHsnCode("");
        setTaxability("");
        setIsActive(true);
        setSaving(false);
    }, [open, kind]);

    async function submit() {
        const trimmedName = name.trim();
        if (kind === "unit") {
            if (!code.trim()) { toast.error("Code is required"); return; }
            if (!trimmedName) { toast.error("Label is required"); return; }
        } else if (!trimmedName) {
            toast.error("Name is required");
            return;
        }

        // Build the per-kind payload. Each shape mirrors the schema columns the
        // master actually has.
        let body: Record<string, unknown>;
        switch (kind) {
            case "brand":
                body = { name: trimmedName, isActive };
                break;
            case "category":
                body = {
                    name: trimmedName,
                    isActive,
                    parentId: parentId === "" ? null : Number(parentId),
                };
                break;
            case "group":
                body = {
                    name: trimmedName,
                    isActive,
                    parentId: parentId === "" ? null : Number(parentId),
                    gstRateId: gstRateId === "" ? null : Number(gstRateId),
                    hsnCode: hsnCode.trim() === "" ? null : hsnCode.trim(),
                    taxability: taxability === "" ? null : taxability,
                };
                break;
            case "warranty": {
                const days = durationDays.trim() === "" ? null : Number(durationDays);
                if (days != null && (!Number.isFinite(days) || days < 0)) {
                    toast.error("Duration must be a non-negative number of days");
                    return;
                }
                body = {
                    name: trimmedName,
                    isActive,
                    description: description.trim() === "" ? null : description.trim(),
                    durationDays: days,
                };
                break;
            }
            case "unit": {
                const dec = decimals.trim() === "" ? 0 : Number(decimals);
                if (!Number.isFinite(dec) || dec < 0 || dec > 6) {
                    toast.error("Decimals must be between 0 and 6");
                    return;
                }
                body = {
                    code: code.trim(),
                    label: trimmedName,
                    decimals: dec,
                    isActive,
                };
                break;
            }
        }

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>(KIND_META[kind].endpoint, body);
            toast.success(`Created ${kind} "${kind === "unit" ? code.trim() : trimmedName}"`);
            await onCreated(res.data.id);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? `Failed to create ${kind}`);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{KIND_META[kind].title}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3">
                    {kind === "unit" ? (
                        <div className="grid grid-cols-3 gap-3">
                            <div className="grid gap-1.5 col-span-1">
                                <Label htmlFor="mq-code">Code</Label>
                                <Input
                                    id="mq-code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="PCS"
                                    maxLength={12}
                                    autoFocus
                                />
                            </div>
                            <div className="grid gap-1.5 col-span-2">
                                <Label htmlFor="mq-label">Label</Label>
                                <Input
                                    id="mq-label"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Pieces"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-1.5">
                            <Label htmlFor="mq-name">Name</Label>
                            <Input
                                id="mq-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={
                                    kind === "category" ? "e.g. Laptops" :
                                    kind === "brand"    ? "e.g. Lenovo" :
                                    kind === "group"    ? "e.g. Laptops" :
                                    /* warranty */        "e.g. 1 year manufacturer"
                                }
                                autoFocus
                            />
                        </div>
                    )}

                    {(kind === "category" || kind === "group") && siblings ? (
                        <div className="grid gap-1.5">
                            <Label>Parent {kind}</Label>
                            <SearchableSelect
                                value={parentId === "" ? null : Number(parentId)}
                                options={flattenTree(siblings).map((r) => ({
                                    value: r.id,
                                    // Indented "-/--/---" prefix per depth in the open list.
                                    label: treeLabel(r),
                                    // Closed trigger shows just the bare name — indent only
                                    // makes sense in the open tree context.
                                    leaf: r.name,
                                    // Search matches the bare name so typing "son" finds
                                    // "--son" without the user typing the dashes.
                                    searchText: r.name,
                                }))}
                                onChange={(id) => setParentId(id == null ? "" : String(id))}
                                placeholder="— none —"
                            />
                            {kind === "group" ? (
                                <p className="text-xs text-muted-foreground">GST / HSN cascade down from parent when blank below. Path shown as Parent &gt; Child.</p>
                            ) : null}
                        </div>
                    ) : null}

                    {kind === "group" ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-1.5">
                                    <Label>GST rate</Label>
                                    <Select
                                        value={gstRateId || "__none__"}
                                        onValueChange={(v) => setGstRateId(v === "__none__" ? "" : v)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="— inherit —" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">— inherit —</SelectItem>
                                            {(gstRates ?? []).map((g) => (
                                                <SelectItem key={g.id} value={String(g.id)}>{g.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="mq-hsn">HSN code</Label>
                                    <Input
                                        id="mq-hsn"
                                        value={hsnCode}
                                        onChange={(e) => setHsnCode(e.target.value)}
                                        placeholder="e.g. 8471"
                                    />
                                </div>
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Taxability</Label>
                                <Select
                                    value={taxability || "__none__"}
                                    onValueChange={(v) => setTaxability(v === "__none__" ? "" : v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="— inherit —" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">— inherit —</SelectItem>
                                        {TAXABILITY_OPTIONS.map((t) => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    ) : null}

                    {kind === "warranty" ? (
                        <>
                            <div className="grid gap-1.5">
                                <Label htmlFor="mq-days">Duration (days)</Label>
                                <Input
                                    id="mq-days"
                                    value={durationDays}
                                    onChange={(e) => setDurationDays(e.target.value.replace(/[^\d]/g, ""))}
                                    placeholder="e.g. 365 (1 year)"
                                    inputMode="numeric"
                                />
                                <p className="text-xs text-muted-foreground">Leave blank for lifetime / no fixed duration.</p>
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="mq-desc">Description</Label>
                                <Input
                                    id="mq-desc"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Optional notes"
                                />
                            </div>
                        </>
                    ) : null}

                    {kind === "unit" ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor="mq-dec">Decimals</Label>
                            <Input
                                id="mq-dec"
                                value={decimals}
                                onChange={(e) => setDecimals(e.target.value.replace(/[^\d]/g, ""))}
                                inputMode="numeric"
                                className="w-24"
                            />
                            <p className="text-xs text-muted-foreground">0 for whole pieces, 2 for kg, etc.</p>
                        </div>
                    ) : null}

                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
                        Active
                    </label>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={submit} disabled={saving}>
                        {saving ? "Creating…" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

