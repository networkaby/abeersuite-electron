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

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import axios from "axios";
import { toast } from "sonner";
import { generateSku } from "@/modules/inventory/lib/sku";
import { parseDecimalInput, parseRupeesToPaise } from "@/shared/lib/format";
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { primaryBarcode } from "@/shared/lib/inventory";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useValueChange } from "@/shared/hooks/useValueChange";

// Lookup-shape matching what /api/inventory/products/lookup returns —
// the parent combobox expects this exact field set when adding to its list.
export type CreatedProductOption = {
    id: number;
    sku: string;
    name: string;
    stock: number | null;
    lowStockThreshold: number;
    pricePaise: number | null;
    /** Last inward rate (paise) derived from the ledger walk — PR 3 dropped the costPaise cache. */
    lastPurchasePaise: number | null;
    mrpPaise: number | null;
    unit: { code: string };
    brand: { name: string } | null;
    barcode1: string | null;
};

type Unit = { id: number; code: string; label: string };

export type AdvancedDefaults = {
    name: string;
    sku: string;
    unitId: string;
    priceRupees: string;
    costRupees: string;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Pre-fills the Name field when opened (typically the combobox's current query). */
    initialName?: string;
    /** Fires with the newly-created product so the parent can append + auto-select. */
    onCreated: (product: CreatedProductOption) => void;
    /**
     * When set, an "Advanced" button appears. Clicking it closes this dialog
     * and fires the callback with the current form values so the caller can
     * open the full product editor pre-filled with the same data.
     */
    onAdvanced?: (defaults: AdvancedDefaults) => void;
};

export function NewProductDialog({ open, onOpenChange, initialName = "", onCreated, onAdvanced }: Props) {
    const [name, setName] = useState(initialName);
    const [sku, setSku] = useState("");
    const [unitId, setUnitId] = useState<string>("");
    const [salePrice, setSalePrice] = useState("");
    const [units, setUnits] = useState<Unit[]>([]);
    const [unitsLoading, setUnitsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [inlineError, setInlineError] = useState<string | null>(null);
    const [skuConflict, setSkuConflict] = useState(false);

    // Reset form whenever the dialog opens with a new initialName (while
    // rendering, so the last product's entry never paints).
    if (useValueChange(open ? initialName : null, null) && open) {
        setName(initialName);
        setSku(generateSku());
        setSalePrice("");
        setUnitId("");
        setInlineError(null);
        setSkuConflict(false);
    }

    // Fetch units + org defaults together so the unit select pre-selects the org default.
    if (useValueChange(open, false) && open) setUnitsLoading(true);
    useEffect(() => {
        if (!open) return;
        Promise.all([
            axios.get<Unit[]>("/api/inventory/units"),
            getOrgDefaults(),
        ])
            .then(([unitsRes, orgDefaults]) => {
                const unitList = unitsRes.data;
                setUnits(unitList);
                const preferred = orgDefaults.defaultUnitId
                    ? unitList.find((u) => u.id === orgDefaults.defaultUnitId)
                    : null;
                setUnitId(String((preferred ?? unitList[0])?.id ?? ""));
            })
            .catch((e) => {
                if (axios.isAxiosError(e) && e.response?.status === 403) {
                    toast.error("You don't have permission to manage inventory");
                } else {
                    toast.error("Failed to load units");
                }
            })
            .finally(() => setUnitsLoading(false));
    }, [open]);

    const handleNameChange = (v: string) => {
        setName(v);
    };

    const onEnterToSave = (e: ReactKeyboardEvent) => {
        if (e.key === "Enter" && !saving) { e.preventDefault(); void submit(); }
    };

    const submit = async () => {
        if (!name.trim()) { setInlineError("Name is required"); return; }
        if (!unitId)      { setInlineError("Pick a unit");       return; }
        setSaving(true);
        setInlineError(null);
        setSkuConflict(false);
        try {
            const res = await axios.post("/api/inventory/products", {
                sku: sku.trim().toUpperCase(),
                name: name.trim(),
                unitId: parseInt(unitId, 10),
                // The human sale price. `pricePaise` is a read-side alias only
                // (lookup route) — the create schema strips it, so it must be
                // sent under the real column or the typed price is lost.
                savedSalePricePaise: parseRupeesToPaise(salePrice),
                isActive: true,
            });
            const p = res.data as {
                id: number; sku: string; name: string;
                stock: number | null; lowStockThreshold: number;
                savedSalePricePaise: number | null;
                effectiveSalePricePaise: number | null;
                mrpPaise: number | null;
                unit: { code: string };
                brand: { name: string } | null;
                codes?: { kind: string; value: string }[];
            };
            // Fresh product has no purchase history yet → lastPurchasePaise=null.
            // The combobox will pick it up via lookup on next refresh.
            onCreated({
                id: p.id, sku: p.sku, name: p.name,
                stock: p.stock, lowStockThreshold: p.lowStockThreshold,
                // The row comes back before the price recompute has materialised
                // effectiveSalePricePaise, so fall back to the price just typed.
                pricePaise: p.effectiveSalePricePaise ?? p.savedSalePricePaise,
                lastPurchasePaise: null, mrpPaise: p.mrpPaise,
                unit: { code: p.unit.code },
                brand: p.brand,
                barcode1: primaryBarcode(p.codes),
            });
            toast.success(`Created ${p.name}`);
            onOpenChange(false);
        } catch (e: unknown) {
            if (axios.isAxiosError(e)) {
                if (e.response?.status === 409) {
                    setSkuConflict(true);
                    setInlineError("That SKU is already taken — click ↻ next to the SKU field to generate a new one.");
                } else if (e.response?.status === 403) {
                    setInlineError("You don't have permission to create products.");
                } else {
                    // Surface the server-side reason where we can — zod validation
                    // failures arrive as `details` or `error` strings depending on
                    // the route's handler.
                    const data = e.response?.data;
                    const msg = (data as { error?: string } | undefined)?.error
                        ?? `Failed to create product (${e.response?.status ?? "network error"})`;
                    setInlineError(msg);
                }
            } else {
                setInlineError("Failed to create product — check your connection and try again.");
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
                            onKeyDown={onEnterToSave}
                            placeholder="Product name"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="np-sku">SKU</Label>
                            <div className="flex gap-1.5">
                                <Input
                                    id="np-sku"
                                    value={sku}
                                    onChange={(e) => { setSku(e.target.value.toUpperCase()); setSkuConflict(false); setInlineError(null); }}
                                    onKeyDown={onEnterToSave}
                                    placeholder="123456"
                                    className={`font-mono flex-1 ${skuConflict ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    title="Generate a new SKU"
                                    onClick={() => { setSku(generateSku()); setSkuConflict(false); setInlineError(null); }}
                                    disabled={saving}
                                    className="shrink-0"
                                >
                                    <RefreshCw size={13} />
                                </Button>
                            </div>
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
                    <div className="grid gap-1.5">
                        <Label htmlFor="np-sale">Sale Price (₹) <span className="text-muted-foreground">opt</span></Label>
                        <Input
                            id="np-sale"
                            type="text"
                            inputMode="decimal"
                            value={salePrice}
                            onChange={(e) => setSalePrice(parseDecimalInput(e.target.value))}
                            onKeyDown={onEnterToSave}
                            placeholder="0.00"
                            className="tabular-nums text-right"
                        />
                    </div>
                </div>
                {inlineError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{inlineError}</span>
                    </div>
                )}
                <DialogFooter className="flex-row items-center justify-between gap-2">
                    <div className="flex gap-2">
                        {onAdvanced && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onAdvanced({ name, sku, unitId, priceRupees: salePrice, costRupees: "" });
                                    onOpenChange(false);
                                }}
                                disabled={saving}
                                title="Open the full product editor with these values pre-filled"
                            >
                                Advanced…
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={saving || !name.trim() || !unitId}>
                            {saving && <Loader2 size={14} className="animate-spin mr-1" />}
                            Save
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
