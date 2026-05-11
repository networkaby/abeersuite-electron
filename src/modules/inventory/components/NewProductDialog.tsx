"use client";

/**
 * NewProductDialog — minimal quick-create form launched from inside the
 * InvProductCombobox dropdown ("+ New product" CTA), modeled after
 * PartySearchAndCreate's "+ New customer" pattern.
 *
 * Captures only the bare minimum to make a usable product line on a sale:
 *   Name (pre-filled from the typed query) · SKU (auto-generated, editable)
 *   · Unit (required FK) · Sale Price ₹ (optional) · Cost Price ₹ (optional)
 *
 * On success, returns a lookup-shaped product so the parent combobox can
 * append it to its in-memory list and auto-select it without a full re-fetch.
 *
 * Permissions: POSTing to /api/inventory/products + /api/inventory/units
 * requires `inventory:manage`. If the caller is a cashier without that
 * permission, the 403 surfaces as a toast and the dialog stays open so
 * they can dismiss it.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Lookup-shape matching what /api/inventory/products/lookup returns —
// the parent combobox expects this exact field set when adding to its list.
export type CreatedProductOption = {
    id: number;
    sku: string;
    name: string;
    stock: number | null;
    lowStockThreshold: number;
    pricePaise: number | null;
    costPaise: number | null;
    mrpPaise: number | null;
    unit: { code: string };
    brand: { name: string } | null;
    barcode1: string | null;
};

type Unit = { id: number; code: string; label: string };

// Naive SKU generator — first 6 alnum chars of the name + 4-char random tail.
// Server returns 409 on duplicate; we display the conflict so the user can edit.
function generateSku(name: string): string {
    const base = name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6) || "ITEM";
    const tail = Math.random().toString(36).slice(-4).toUpperCase();
    return `${base}-${tail}`;
}

// ₹ → paise; empty / non-numeric → null so optional fields stay unset.
function rupeesToPaise(s: string): number | null {
    const v = parseFloat(s);
    if (!isFinite(v) || v <= 0) return null;
    return Math.round(v * 100);
}

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Pre-fills the Name field when opened (typically the combobox's current query). */
    initialName?: string;
    /** Fires with the newly-created product so the parent can append + auto-select. */
    onCreated: (product: CreatedProductOption) => void;
};

export function NewProductDialog({ open, onOpenChange, initialName = "", onCreated }: Props) {
    const [name, setName] = useState(initialName);
    const [sku, setSku] = useState("");
    const [unitId, setUnitId] = useState<string>("");
    const [salePrice, setSalePrice] = useState("");
    const [costPrice, setCostPrice] = useState("");
    const [units, setUnits] = useState<Unit[]>([]);
    const [unitsLoading, setUnitsLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Reset form whenever the dialog opens with a new initialName.
    useEffect(() => {
        if (!open) return;
        setName(initialName);
        setSku(generateSku(initialName || "ITEM"));
        setSalePrice("");
        setCostPrice("");
    }, [open, initialName]);

    // Fetch the units list once (cached server-side via unstable_cache).
    useEffect(() => {
        if (!open) return;
        setUnitsLoading(true);
        axios.get<Unit[]>("/api/inventory/units")
            .then((r) => {
                setUnits(r.data);
                // Pre-select the first active unit so the user can save without picking.
                if (r.data[0] && !unitId) setUnitId(String(r.data[0].id));
            })
            .catch((e) => {
                if (axios.isAxiosError(e) && e.response?.status === 403) {
                    toast.error("You don't have permission to manage inventory");
                } else {
                    toast.error("Failed to load units");
                }
            })
            .finally(() => setUnitsLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Re-derive SKU when the user types a new name — but only while they
    // haven't manually edited the SKU field. The flag is implicit: if the
    // current SKU still matches what generateSku(prevName) would produce
    // for the prefix, we treat it as auto. Simpler heuristic: always
    // regenerate while the SKU field hasn't been touched after dialog open.
    // For now, regenerate on every name change unless the user has typed
    // something custom — leave that polish for later.
    const handleNameChange = (v: string) => {
        setName(v);
        // Regenerate SKU if the current SKU was auto (starts with derived prefix).
        const autoPrefix = (name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6) || "ITEM") + "-";
        if (sku.startsWith(autoPrefix) || !sku) {
            setSku(generateSku(v || "ITEM"));
        }
    };

    const submit = async () => {
        if (!name.trim()) { toast.error("Name is required"); return; }
        if (!unitId)      { toast.error("Pick a unit");       return; }
        setSaving(true);
        try {
            const res = await axios.post("/api/inventory/products", {
                sku: sku.trim().toUpperCase(),
                name: name.trim(),
                unitId: parseInt(unitId, 10),
                pricePaise: rupeesToPaise(salePrice),
                costPaise:  rupeesToPaise(costPrice),
                isActive: true,
            });
            const p = res.data as {
                id: number; sku: string; name: string;
                stock: number | null; lowStockThreshold: number;
                pricePaise: number | null; costPaise: number | null; mrpPaise: number | null;
                unit: { code: string };
                brand: { name: string } | null;
                barcode1?: string | null;
            };
            onCreated({
                id: p.id, sku: p.sku, name: p.name,
                stock: p.stock, lowStockThreshold: p.lowStockThreshold,
                pricePaise: p.pricePaise, costPaise: p.costPaise, mrpPaise: p.mrpPaise,
                unit: { code: p.unit.code },
                brand: p.brand,
                barcode1: p.barcode1 ?? null,
            });
            toast.success(`Created ${p.name}`);
            onOpenChange(false);
        } catch (e: unknown) {
            if (axios.isAxiosError(e)) {
                if (e.response?.status === 409) {
                    toast.error("That SKU already exists — try a different one");
                } else if (e.response?.status === 403) {
                    toast.error("You don't have permission to create products");
                } else {
                    // Surface the server-side reason where we can — zod validation
                    // failures arrive as `details` or `error` strings depending on
                    // the route's handler.
                    const data = e.response?.data;
                    const msg = data?.error
                        ?? (Array.isArray(data?.details) ? data.details.map((d: { message?: string }) => d.message).filter(Boolean).join(", ") : null)
                        ?? data?.message
                        ?? `Failed to create product (${e.response?.status ?? "?"})`;
                    toast.error(msg);
                }
            } else {
                toast.error("Failed to create product");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New Product</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="np-name">Name</Label>
                        <Input
                            id="np-name"
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            placeholder="Product name"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="np-sku">SKU</Label>
                            <Input
                                id="np-sku"
                                value={sku}
                                onChange={(e) => setSku(e.target.value.toUpperCase())}
                                placeholder="AUTO-1234"
                                className="font-mono"
                            />
                        </div>
                        <div className="grid gap-1.5 w-32">
                            <Label htmlFor="np-unit">Unit</Label>
                            <Select value={unitId} onValueChange={setUnitId} disabled={unitsLoading}>
                                <SelectTrigger id="np-unit">
                                    <SelectValue placeholder="Pick…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {units.map((u) => (
                                        <SelectItem key={u.id} value={String(u.id)}>
                                            {u.code} {u.label && u.label !== u.code ? `· ${u.label}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="np-sale">Sale Price (₹) <span className="text-muted-foreground">opt</span></Label>
                            <Input
                                id="np-sale"
                                type="text"
                                inputMode="decimal"
                                value={salePrice}
                                onChange={(e) => setSalePrice(e.target.value.replace(/[^\d.]/g, ""))}
                                placeholder="0.00"
                                className="tabular-nums text-right"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="np-cost">Cost Price (₹) <span className="text-muted-foreground">opt</span></Label>
                            <Input
                                id="np-cost"
                                type="text"
                                inputMode="decimal"
                                value={costPrice}
                                onChange={(e) => setCostPrice(e.target.value.replace(/[^\d.]/g, ""))}
                                placeholder="0.00"
                                className="tabular-nums text-right"
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={saving || !name.trim() || !unitId}>
                        {saving && <Loader2 size={14} className="animate-spin mr-1" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
