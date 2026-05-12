"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateSku } from "@/modules/inventory/lib/sku";

export type InvProductFormState = {
    sku: string;
    name: string;
    unitId: string;
    categoryId: string;
    groupId: string;
    brandId: string;
    warrantyTermId: string;
    modelNo: string;
    barcode1: string;
    barcode2: string;
    barcode3: string;
    ean1: string;
    ean2: string;
    ean3: string;
    upc1: string;
    upc2: string;
    upc3: string;
    notes: string;
    isActive: boolean;
    // Pricing — entered in rupees, converted to paise on submit.
    costRupees:  string;
    priceRupees: string;
    mrpRupees:   string;
    // Opening stock — written directly to InvProduct.openingStock /
    // openingRate / openingValue / openingStockDate. Tally-style: this is
    // qty held at books-beginning, NOT a transactional movement.
    openingQty:    string;
    openingRate:   string;
    openingDate:   string;
};

export const emptyInvProductForm: InvProductFormState = {
    sku: "",
    name: "",
    unitId: "",
    categoryId: "",
    groupId: "",
    brandId: "",
    warrantyTermId: "",
    modelNo: "",
    barcode1: "",
    barcode2: "",
    barcode3: "",
    ean1: "",
    ean2: "",
    ean3: "",
    upc1: "",
    upc2: "",
    upc3: "",
    notes: "",
    isActive: true,
    costRupees:  "",
    priceRupees: "",
    mrpRupees:   "",
    openingQty:  "",
    openingRate: "",
    openingDate: "",
};

type Opt = { id: number; name?: string; code?: string; label?: string };

export function InvProductFormFields({
    form,
    setForm,
    units,
    categories,
    groups,
    brands,
    warrantyTerms,
    skuDisabled,
}: {
    form: InvProductFormState;
    setForm: React.Dispatch<React.SetStateAction<InvProductFormState>>;
    units: Opt[];
    categories: Opt[];
    groups: Opt[];
    brands: Opt[];
    warrantyTerms: Opt[];
    skuDisabled?: boolean;
}) {
    const label = (o: Opt) => o.name ?? `${o.code ?? ""} ${o.label ?? ""}`.trim();

    // Tab-panel min-height keeps the dialog from jumping as the user moves
    // between Basics (longest) and Pricing / Opening (shortest). 380px fits
    // the Pricing tab without dead space and is comfortable on Basics.
    const tabPanel = "mt-4 min-h-[380px]";

    return (
        <Tabs defaultValue="basics" className="w-full">
            {/* Horizontal scroll on narrow viewports so all 5 tab labels stay
                fully readable; on desktop they fit comfortably side-by-side. */}
            <TabsList className="flex w-full justify-start overflow-x-auto whitespace-nowrap">
                <TabsTrigger value="basics">Basics</TabsTrigger>
                <TabsTrigger value="pricing">Pricing</TabsTrigger>
                <TabsTrigger value="stock">Stock control</TabsTrigger>
                <TabsTrigger value="opening">Opening</TabsTrigger>
                <TabsTrigger value="online">Online listing</TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className={tabPanel}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                        <Label>SKU</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                value={form.sku}
                                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                                disabled={skuDisabled}
                                className="font-mono"
                                placeholder="6-digit code"
                            />
                            {!skuDisabled && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    onClick={() => setForm((f) => ({ ...f, sku: generateSku() }))}
                                    title="Generate random 6-digit SKU"
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Auto-filled with a random 6-digit code. Editable; must stay unique.</p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Name</Label>
                        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                        <Label>Unit</Label>
                        <Select value={form.unitId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, unitId: v === "__none__" ? "" : v }))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">Select…</SelectItem>
                                {units.map((u) => (
                                    <SelectItem key={u.id} value={String(u.id)}>
                                        {u.code} — {u.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Model no.</Label>
                        <Input value={form.modelNo} onChange={(e) => setForm((f) => ({ ...f, modelNo: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={form.categoryId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v === "__none__" ? "" : v }))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {categories.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>
                                        {label(c)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Group</Label>
                        <Select value={form.groupId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, groupId: v === "__none__" ? "" : v }))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {groups.map((g) => (
                                    <SelectItem key={g.id} value={String(g.id)}>
                                        {label(g)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Brand</Label>
                        <Select value={form.brandId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, brandId: v === "__none__" ? "" : v }))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {brands.map((b) => (
                                    <SelectItem key={b.id} value={String(b.id)}>
                                        {label(b)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Notes</Label>
                        <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} />
                    </div>
                    <div className="flex items-center sm:col-span-2">
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                            Active
                        </label>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="pricing" className={tabPanel}>
                <p className="text-xs text-muted-foreground mb-3">
                    All amounts in rupees (₹). Cost auto-updates on every Purchase voucher; you can override here.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                        <Label>Cost price (₹)</Label>
                        <Input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={form.costRupees}
                            onChange={(e) => setForm((f) => ({ ...f, costRupees: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Last purchase rate; basis for COGS.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Sale price (₹)</Label>
                        <Input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={form.priceRupees}
                            onChange={(e) => setForm((f) => ({ ...f, priceRupees: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Default sale rate (shop / retail).</p>
                    </div>
                    <div className="space-y-2">
                        <Label>MRP (₹)</Label>
                        <Input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={form.mrpRupees}
                            onChange={(e) => setForm((f) => ({ ...f, mrpRupees: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Maximum retail price (printed).</p>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="stock" className={tabPanel}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Warranty term</Label>
                        <Select value={form.warrantyTermId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, warrantyTermId: v === "__none__" ? "" : v }))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {warrantyTerms.map((w) => (
                                    <SelectItem key={w.id} value={String(w.id)}>
                                        {label(w)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2 sm:col-span-2">
                        <p className="text-sm font-semibold">Barcodes</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">1</Label>
                                <Input value={form.barcode1} onChange={(e) => setForm((f) => ({ ...f, barcode1: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">2</Label>
                                <Input value={form.barcode2} onChange={(e) => setForm((f) => ({ ...f, barcode2: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">3</Label>
                                <Input value={form.barcode3} onChange={(e) => setForm((f) => ({ ...f, barcode3: e.target.value }))} />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <p className="text-sm font-semibold">EAN</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                            {(["ean1", "ean2", "ean3"] as const).map((k, i) => (
                                <div key={k} className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{i + 1}</Label>
                                    <Input inputMode="numeric" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <p className="text-sm font-semibold">UPC</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                            {(["upc1", "upc2", "upc3"] as const).map((k, i) => (
                                <div key={k} className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{i + 1}</Label>
                                    <Input inputMode="numeric" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="opening" className={tabPanel}>
                <p className="text-xs text-muted-foreground mb-3">
                    Books-beginning quantity for migration from another system. Saved directly to{" "}
                    <code>InvProduct.openingStock / openingRate / openingValue</code>. Reports use this on{" "}
                    <em>{"as of"}</em> date and after; vouchers add or subtract from there.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                        <Label>Opening qty</Label>
                        <Input
                            type="number" min="0" step="0.001" inputMode="decimal"
                            value={form.openingQty}
                            onChange={(e) => setForm((f) => ({ ...f, openingQty: e.target.value }))}
                            placeholder="0"
                        />
                        <p className="text-[11px] text-muted-foreground">In product unit.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Opening rate (₹)</Label>
                        <Input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={form.openingRate}
                            onChange={(e) => setForm((f) => ({ ...f, openingRate: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Cost per unit at books-beginning.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>As of</Label>
                        <Input
                            type="date"
                            value={form.openingDate}
                            onChange={(e) => setForm((f) => ({ ...f, openingDate: e.target.value }))}
                        />
                        <p className="text-[11px] text-muted-foreground">Books-beginning date.</p>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                    <strong>Opening value</strong> = qty × rate ={" "}
                    <span className="font-mono">
                        ₹ {((parseFloat(form.openingQty) || 0) * (parseFloat(form.openingRate) || 0)).toFixed(2)}
                    </span>{" "}
                    <span className="text-muted-foreground/70">(auto-computed on save)</span>
                </p>
            </TabsContent>

            <TabsContent value="online" className={tabPanel}>
                <p className="text-sm text-muted-foreground">
                    Shop listing fields (image, slug, shop description, gallery, etc.) live on <code>InvProduct</code> but aren&apos;t exposed in this form yet. Use <em>Edit shop listing</em> from the product list to set them.
                </p>
            </TabsContent>
        </Tabs>
    );
}
