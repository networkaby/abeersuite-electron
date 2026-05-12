"use client";

import { useEffect, useRef } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
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
import {
    buildOfflineName,
    buildOnlineName,
    buildOnlineSlug,
    type NamingConfigShape,
    type NamingMasters,
} from "@/modules/inventory/lib/productName";

export type InvProductFormState = {
    sku: string;
    name: string;
    /** Online (storefront) display name — written to InvProduct.shopSubheading. */
    shopSubheading: string;
    /** URL slug — written to InvProduct.slug. */
    slug: string;
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
    /** Custom attribute pairs — stored as attrsJson in DB. */
    attrs: Array<{ key: string; value: string }>;
};

export const emptyInvProductForm: InvProductFormState = {
    sku: "",
    name: "",
    shopSubheading: "",
    slug: "",
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
    attrs: [],
};

type Opt = { id: number; name?: string; code?: string; label?: string };

export type AttrMasterRow = { id: number; key: string; name: string; categoryId: number | null; isActive: boolean };

export function InvProductFormFields({
    form,
    setForm,
    units,
    categories,
    groups,
    brands,
    warrantyTerms,
    skuDisabled,
    namingConfig,
    attrMasters = [],
    /** true = edit mode; all dirty flags start true so existing values aren't clobbered. */
    isEditMode = false,
}: {
    form: InvProductFormState;
    setForm: React.Dispatch<React.SetStateAction<InvProductFormState>>;
    units: Opt[];
    categories: Opt[];
    groups: Opt[];
    brands: Opt[];
    warrantyTerms: Opt[];
    skuDisabled?: boolean;
    namingConfig?: NamingConfigShape | null;
    attrMasters?: AttrMasterRow[];
    isEditMode?: boolean;
}) {
    const label = (o: Opt) => o.name ?? `${o.code ?? ""} ${o.label ?? ""}`.trim();

    // Per-field dirty flags: once the user hand-edits Name / Online name /
    // Slug, master changes stop auto-filling that field. Edit mode opens with
    // all flags `true` so existing saved values are preserved.
    const nameDirty = useRef(isEditMode);
    const onlineNameDirty = useRef(isEditMode);
    const slugDirty = useRef(isEditMode);

    const findById = (list: Opt[], id: string) =>
        id ? list.find((o) => String(o.id) === id) ?? null : null;

    // Build the masters snapshot from current form + reference lists.
    const buildMasters = (): NamingMasters => ({
        brand:    findById(brands,        form.brandId)        ? { name: findById(brands,        form.brandId)!.name ?? "" }       : null,
        category: findById(categories,    form.categoryId)     ? { name: findById(categories,    form.categoryId)!.name ?? "" }    : null,
        group:    findById(groups,        form.groupId)        ? { name: findById(groups,        form.groupId)!.name ?? "" }       : null,
        warranty: findById(warrantyTerms, form.warrantyTermId) ? { name: findById(warrantyTerms, form.warrantyTermId)!.name ?? "" }: null,
        unit:     findById(units,         form.unitId)         ? { code: findById(units,         form.unitId)!.code ?? "" }        : null,
        modelNo:  form.modelNo || null,
        attrs:    form.attrs.length > 0
            ? Object.fromEntries(form.attrs.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value.trim()]))
            : null,
    });

    // Re-generate a single field on demand (used by the refresh buttons in
    // edit mode). Resets the dirty flag so future master changes auto-fill again.
    function regenField(which: "name" | "onlineName" | "slug") {
        if (!namingConfig) return;
        const masters = buildMasters();
        if (which === "name") {
            nameDirty.current = false;
            setForm((f) => ({ ...f, name: buildOfflineName(masters, namingConfig) }));
        } else if (which === "onlineName") {
            onlineNameDirty.current = false;
            setForm((f) => ({ ...f, shopSubheading: buildOnlineName(masters, namingConfig) }));
        } else {
            slugDirty.current = false;
            setForm((f) => ({ ...f, slug: buildOnlineSlug(masters, namingConfig) }));
        }
    }

    // Live auto-fill from masters whenever a token-source field changes.
    useEffect(() => {
        if (!namingConfig) return;
        const masters = buildMasters();
        const nextName       = nameDirty.current       ? null : buildOfflineName(masters, namingConfig);
        const nextOnlineName = onlineNameDirty.current ? null : buildOnlineName(masters, namingConfig);
        const nextSlug       = slugDirty.current       ? null : buildOnlineSlug(masters, namingConfig);
        setForm((f) => ({
            ...f,
            ...(nextName       !== null ? { name:           nextName }       : {}),
            ...(nextOnlineName !== null ? { shopSubheading: nextOnlineName } : {}),
            ...(nextSlug       !== null ? { slug:           nextSlug }       : {}),
        }));
    }, [
        form.brandId, form.categoryId, form.groupId, form.warrantyTermId,
        form.unitId, form.modelNo, form.attrs,
        brands, categories, groups, warrantyTerms, units,
        namingConfig, setForm,
    ]);

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
                        <div className="flex items-center gap-2">
                            <Input
                                value={form.name}
                                onChange={(e) => {
                                    nameDirty.current = true;
                                    setForm((f) => ({ ...f, name: e.target.value }));
                                }}
                            />
                            {namingConfig && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    onClick={() => regenField("name")}
                                    title="Re-generate name from naming convention"
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            )}
                        </div>
                        {namingConfig && !nameDirty.current ? (
                            <p className="text-[11px] text-muted-foreground">Auto-filled from naming convention. Type to override.</p>
                        ) : null}
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

                    <div className="space-y-2 sm:col-span-2">
                        <div className="flex items-center justify-between">
                            <Label>Attributes</Label>
                            <p className="text-[11px] text-muted-foreground">Used in naming convention &amp; SEO</p>
                        </div>
                        {(() => {
                            // Filter masters to those applicable to the current category (global + category-specific).
                            const catId = form.categoryId ? Number(form.categoryId) : null;
                            const available = attrMasters.filter(
                                (m) => m.isActive !== false && (m.categoryId == null || m.categoryId === catId),
                            );
                            const usedKeys = new Set(form.attrs.map((a) => a.key));
                            const addable = available.filter((m) => !usedKeys.has(m.key));
                            return (
                                <>
                                    {form.attrs.length > 0 && (
                                        <div className="space-y-1.5">
                                            {form.attrs.map((a, i) => {
                                                const master = attrMasters.find((m) => m.key === a.key);
                                                return (
                                                    <div key={i} className="flex items-center gap-2">
                                                        <span className="min-w-[120px] font-mono text-xs font-medium text-muted-foreground" title={a.key}>
                                                            {master ? master.name : a.key}
                                                        </span>
                                                        <span className="text-muted-foreground text-xs">:</span>
                                                        <Input
                                                            className="flex-1 text-sm"
                                                            value={a.value}
                                                            onChange={(e) => {
                                                                const next = form.attrs.slice();
                                                                next[i] = { ...a, value: e.target.value };
                                                                setForm((f) => ({ ...f, attrs: next }));
                                                            }}
                                                            placeholder="value"
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon-sm"
                                                            onClick={() => setForm((f) => ({ ...f, attrs: f.attrs.filter((_, idx) => idx !== i) }))}
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {addable.length > 0 ? (
                                        <Select
                                            value=""
                                            onValueChange={(key) => {
                                                if (!key) return;
                                                setForm((f) => ({ ...f, attrs: [...f.attrs, { key, value: "" }] }));
                                            }}
                                        >
                                            <SelectTrigger className="w-56">
                                                <SelectValue placeholder="Add attribute…" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {addable.map((m) => (
                                                    <SelectItem key={m.key} value={m.key}>
                                                        {m.name} <span className="text-muted-foreground font-mono text-xs ml-1">({m.key})</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : addable.length === 0 && available.length > 0 ? (
                                        <p className="text-xs text-muted-foreground">All available attributes added.</p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            No attributes defined for this category.{" "}
                                            <a href="/office/inventory/configure/attribute-masters" className="underline" target="_blank" rel="noreferrer">
                                                Manage attribute masters
                                            </a>
                                        </p>
                                    )}
                                </>
                            );
                        })()}
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
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Online display name</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                value={form.shopSubheading}
                                onChange={(e) => {
                                    onlineNameDirty.current = true;
                                    setForm((f) => ({ ...f, shopSubheading: e.target.value }));
                                }}
                                placeholder="Shown on /shop product cards & detail page"
                            />
                            {namingConfig && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    onClick={() => regenField("onlineName")}
                                    title="Re-generate online name from naming convention"
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            )}
                        </div>
                        {namingConfig && !onlineNameDirty.current ? (
                            <p className="text-[11px] text-muted-foreground">Auto-filled from naming convention. Type to override.</p>
                        ) : null}
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <Label>URL slug</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                value={form.slug}
                                onChange={(e) => {
                                    slugDirty.current = true;
                                    setForm((f) => ({ ...f, slug: e.target.value }));
                                }}
                                className="font-mono flex-1"
                                placeholder="my-product-handle"
                            />
                            {namingConfig && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    onClick={() => regenField("slug")}
                                    title="Re-generate slug from naming convention"
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            URL handle for <code>/shop/product/&lt;slug&gt;</code>. Must be unique.
                            {namingConfig && !slugDirty.current ? " Auto-filled from naming convention; type to override." : ""}
                        </p>
                    </div>
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                        Other shop fields (image, gallery, description, badge) aren&apos;t exposed here yet — use <em>Edit shop listing</em> from the product list.
                    </p>
                </div>
            </TabsContent>
        </Tabs>
    );
}
