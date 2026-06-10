"use client";

/* eslint-disable react-hooks/refs */
// This form uses ref.current reads in JSX render to gate "auto-filled" hints
// (nameDirty / onlineNameDirty / slugDirty). They flip on user input via
// onChange. The new react-hooks/refs rule forbids reading .current during
// render, but here it's just a boolean hint — reading a stale value across
// renders is acceptable since the next user keystroke will fix it.

import { useEffect, useRef } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { flattenTree, treeLabel, type MasterKind } from "@/modules/inventory/components/InventoryMasterDropdownQuickDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
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
import { PRODUCT_CODE_KINDS, type ProductCode, type ProductCodeKind } from "@/shared/lib/inventory";

export type InvProductFormState = {
    sku: string;
    name: string;
    /** Operator-curated free text that survives name regeneration. Written
     *  to InvProduct.namePart and rendered by the `userPart` token in the
     *  naming-convention template. */
    namePart: string;
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
    /** Scannable codes (barcode / EAN / UPC) — replaces the old barcode1-3 /
     *  ean1-3 / upc1-3 fields with a dynamic list. */
    codes: ProductCode[];
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
    // GST classification — all optional; empty = "inherit from group/org-default".
    // These must NEVER be prefilled; empty string means null (cascade applies).
    gstRateId:  string;
    hsnCode:    string;
    taxability: string;
};

export const emptyInvProductForm: InvProductFormState = {
    sku: "",
    name: "",
    namePart: "",
    shopSubheading: "",
    slug: "",
    unitId: "",
    categoryId: "",
    groupId: "",
    brandId: "",
    warrantyTermId: "",
    modelNo: "",
    codes: [],
    notes: "",
    isActive: true,
    costRupees:  "",
    priceRupees: "",
    mrpRupees:   "",
    openingQty:  "",
    openingRate: "",
    openingDate: "",
    attrs: [],
    // GST fields — always empty on create; never prefilled.
    gstRateId:  "",
    hsnCode:    "",
    taxability: "",
};

type Opt = { id: number; name?: string; code?: string; label?: string };

export type GstRateOpt = { id: number; rate: string | number; label: string; isActive: boolean };

/** Read-only cascade preview returned by /api/inventory/products/[id]/resolved-tax */
export type EffectiveTax = {
    gstRate: number | null;
    gstRateLabel: string | null;
    gstSource: string | { kind: "group"; groupId: number; groupName: string } | null;
    hsnCode: string | null;
    hsnSource: string | { kind: "group"; groupId: number; groupName: string } | null;
    taxability: string | null;
    taxabilitySource: string | { kind: "group"; groupId: number; groupName: string } | null;
};

export type AttrMasterRow = { id: number; key: string; name: string; categoryId: number | null; isActive: boolean };

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE",  label: "Taxable" },
    { value: "EXEMPT",   label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST",  label: "Non-GST" },
] as const;

function taxSourceLabel(src: EffectiveTax["gstSource"]): string {
    if (!src) return "not set";
    if (src === "product") return "this product";
    if (src === "org-default") return "org default";
    if (typeof src === "object" && src.kind === "group") return `group: ${src.groupName}`;
    return String(src);
}

export type InvProductFormTab = "basics" | "pricing" | "stock" | "tax" | "opening" | "online";

export function InvProductFormFields({
    form,
    setForm,
    units,
    categories,
    groups,
    brands,
    warrantyTerms,
    gstRates = [],
    effectiveTax,
    skuDisabled,
    namingConfig,
    attrMasters = [],
    /** true = edit mode; all dirty flags start true so existing values aren't clobbered. */
    isEditMode = false,
    defaultTab = "basics",
    onCreateMaster,
}: {
    form: InvProductFormState;
    setForm: React.Dispatch<React.SetStateAction<InvProductFormState>>;
    units: Opt[];
    categories: Opt[];
    groups: Opt[];
    brands: Opt[];
    warrantyTerms: Opt[];
    gstRates?: GstRateOpt[];
    /** Read-only cascade preview. Undefined while loading; null if not applicable. */
    effectiveTax?: EffectiveTax | null;
    skuDisabled?: boolean;
    namingConfig?: NamingConfigShape | null;
    attrMasters?: AttrMasterRow[];
    isEditMode?: boolean;
    /** Initial tab. Callers that deep-link into a specific concern (e.g. Tax
     * Classification report → pencil) pass "tax" so the dialog opens on it. */
    defaultTab?: InvProductFormTab;
    /** When provided, renders a "+ New" button next to each master picker that
     *  opens the InventoryMasterDropdownQuickDialog. Caller resolves with the new row id (or null
     *  if cancelled) — the form auto-selects it. */
    onCreateMaster?: (kind: MasterKind) => Promise<number | null>;
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
        userPart: form.namePart || null,
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
        form.unitId, form.modelNo, form.attrs, form.namePart,
        brands, categories, groups, warrantyTerms, units,
        namingConfig, setForm,
    ]);

    // Tab-panel min-height keeps the dialog from jumping as the user moves
    // between Basics (longest) and Pricing / Opening (shortest). 380px fits
    // the Pricing tab without dead space and is comfortable on Basics.
    const tabPanel = "mt-4 min-h-[380px]";

    return (
        <Tabs defaultValue={defaultTab} className="w-full">
            {/* Horizontal scroll on narrow viewports so all 5 tab labels stay
                fully readable; on desktop they fit comfortably side-by-side. */}
            <TabsList className="flex w-full justify-start overflow-x-auto whitespace-nowrap">
                <TabsTrigger value="basics">Basics</TabsTrigger>
                <TabsTrigger value="pricing">Pricing</TabsTrigger>
                <TabsTrigger value="stock">Stock control</TabsTrigger>
                <TabsTrigger value="tax">Tax</TabsTrigger>
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
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Custom name part</Label>
                        <Input
                            value={form.namePart}
                            onChange={(e) => setForm((f) => ({ ...f, namePart: e.target.value }))}
                            placeholder="e.g. 1.5M Special, Compatible Xerox"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Operator-curated free text. The <strong>regenerate</strong> button rebuilds the
                            Name from masters around this value — it survives every regeneration.
                            Renders wherever the <code>userPart</code> token sits in the naming-convention template.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label>Unit</Label>
                        <Select
                            value={form.unitId || "__none__"}
                            onValueChange={async (v) => {
                                if (v === "__new__" && onCreateMaster) {
                                    const id = await onCreateMaster("unit");
                                    if (id != null) setForm((f) => ({ ...f, unitId: String(id) }));
                                    return;
                                }
                                setForm((f) => ({ ...f, unitId: v === "__none__" ? "" : v }));
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">Select…</SelectItem>
                                {onCreateMaster ? <SelectItem value="__new__">+ New unit…</SelectItem> : null}
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
                        <Select
                            value={form.categoryId || "__none__"}
                            onValueChange={async (v) => {
                                if (v === "__new__" && onCreateMaster) {
                                    const id = await onCreateMaster("category");
                                    if (id != null) setForm((f) => ({ ...f, categoryId: String(id) }));
                                    return;
                                }
                                setForm((f) => ({ ...f, categoryId: v === "__none__" ? "" : v }));
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {onCreateMaster ? <SelectItem value="__new__">+ New category…</SelectItem> : null}
                                {flattenTree(categories).map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>
                                        {treeLabel(r)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Group</Label>
                        <Select
                            value={form.groupId || "__none__"}
                            onValueChange={async (v) => {
                                if (v === "__new__" && onCreateMaster) {
                                    const id = await onCreateMaster("group");
                                    if (id != null) setForm((f) => ({ ...f, groupId: String(id) }));
                                    return;
                                }
                                setForm((f) => ({ ...f, groupId: v === "__none__" ? "" : v }));
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {onCreateMaster ? <SelectItem value="__new__">+ New group…</SelectItem> : null}
                                {flattenTree(groups).map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>
                                        {treeLabel(r)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Brand</Label>
                        <Select
                            value={form.brandId || "__none__"}
                            onValueChange={async (v) => {
                                if (v === "__new__" && onCreateMaster) {
                                    const id = await onCreateMaster("brand");
                                    if (id != null) setForm((f) => ({ ...f, brandId: String(id) }));
                                    return;
                                }
                                setForm((f) => ({ ...f, brandId: v === "__none__" ? "" : v }));
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {onCreateMaster ? <SelectItem value="__new__">+ New brand…</SelectItem> : null}
                                {brands.map((b) => (
                                    <SelectItem key={b.id} value={String(b.id)}>
                                        {label(b)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Warranty term</Label>
                        <Select
                            value={form.warrantyTermId || "__none__"}
                            onValueChange={async (v) => {
                                if (v === "__new__" && onCreateMaster) {
                                    const id = await onCreateMaster("warranty");
                                    if (id != null) setForm((f) => ({ ...f, warrantyTermId: String(id) }));
                                    return;
                                }
                                setForm((f) => ({ ...f, warrantyTermId: v === "__none__" ? "" : v }));
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Optional" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {onCreateMaster ? <SelectItem value="__new__">+ New warranty term…</SelectItem> : null}
                                {warrantyTerms.map((w) => (
                                    <SelectItem key={w.id} value={String(w.id)}>
                                        {label(w)}
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
                                            <a href="/office/inventory/masters/attribute-masters" className="underline" target="_blank" rel="noreferrer">
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
                    All amounts in rupees (₹). Cost is derived from the Opening tab&apos;s
                    opening rate + subsequent Purchase vouchers — set it there, not here.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Sale price (₹)</Label>
                        <Input
                            type="text" inputMode="decimal"
                            value={form.priceRupees}
                            onChange={(e) => setForm((f) => ({ ...f, priceRupees: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Default sale rate (shop / retail).</p>
                    </div>
                    <div className="space-y-2">
                        <Label>MRP (₹)</Label>
                        <Input
                            type="text" inputMode="decimal"
                            value={form.mrpRupees}
                            onChange={(e) => setForm((f) => ({ ...f, mrpRupees: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Maximum retail price (printed).</p>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="stock" className={tabPanel}>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Scannable codes</p>
                        <p className="text-[11px] text-muted-foreground">Barcode / EAN / UPC — each must be unique across products.</p>
                    </div>
                    {form.codes.length > 0 && (
                        <div className="space-y-1.5">
                            {form.codes.map((c, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <Select
                                        value={c.kind}
                                        onValueChange={(v) => {
                                            const next = form.codes.slice();
                                            next[i] = { ...c, kind: v as ProductCodeKind };
                                            setForm((f) => ({ ...f, codes: next }));
                                        }}
                                    >
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PRODUCT_CODE_KINDS.map((k) => (
                                                <SelectItem key={k} value={k}>{k}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        className="flex-1 font-mono"
                                        inputMode={c.kind === "BARCODE" ? undefined : "numeric"}
                                        value={c.value}
                                        onChange={(e) => {
                                            const next = form.codes.slice();
                                            next[i] = { ...c, value: e.target.value };
                                            setForm((f) => ({ ...f, codes: next }));
                                        }}
                                        placeholder={c.kind === "EAN" ? "8–13 digits" : c.kind === "UPC" ? "12 digits" : "code"}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-sm"
                                        onClick={() => setForm((f) => ({ ...f, codes: f.codes.filter((_, idx) => idx !== i) }))}
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm((f) => ({ ...f, codes: [...f.codes, { kind: "BARCODE", value: "" } satisfies ProductCode] }))}
                    >
                        + Add code
                    </Button>
                </div>
            </TabsContent>

            <TabsContent value="tax" className={tabPanel}>
                <p className="text-xs text-muted-foreground mb-4">
                    Leave all fields empty to inherit GST / HSN from the product&apos;s group hierarchy.
                    The &quot;Effective&quot; row below shows what will be applied when this product is added to a voucher.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>GST rate</Label>
                        <Select
                            value={form.gstRateId || "__none__"}
                            onValueChange={(v) => setForm((f) => ({ ...f, gstRateId: v === "__none__" ? "" : v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="— inherit —" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">— inherit —</SelectItem>
                                {gstRates.filter((r) => r.isActive).map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>
                                        {r.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Empty = inherit from group / org default.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>HSN / SAC code</Label>
                        <Input
                            value={form.hsnCode}
                            onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value }))}
                            placeholder="Leave empty to inherit"
                            maxLength={32}
                        />
                        <p className="text-[11px] text-muted-foreground">4–8 digit code for GST reports (HSN for goods, SAC for services).</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Taxability</Label>
                        <Select
                            value={form.taxability || "__none__"}
                            onValueChange={(v) => setForm((f) => ({ ...f, taxability: v === "__none__" ? "" : v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="— inherit —" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">— inherit —</SelectItem>
                                {TAXABILITY_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Empty = inherit from group / org default.</p>
                    </div>
                </div>

                {/* Read-only cascade preview */}
                {effectiveTax !== undefined && (
                    <div className="mt-5 rounded-md border bg-muted/40 p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Effective (cascade result)</p>
                        <div className="grid gap-1 text-xs sm:grid-cols-3">
                            <div>
                                <span className="text-muted-foreground">GST rate: </span>
                                {effectiveTax == null ? (
                                    <span className="text-muted-foreground italic">loading…</span>
                                ) : effectiveTax.gstRate != null ? (
                                    <><span className="font-medium">{Number(effectiveTax.gstRate).toFixed(2)}%</span> <span className="text-muted-foreground">({taxSourceLabel(effectiveTax.gstSource)})</span></>
                                ) : (
                                    <span className="text-muted-foreground italic">not set</span>
                                )}
                            </div>
                            <div>
                                <span className="text-muted-foreground">HSN: </span>
                                {effectiveTax == null ? (
                                    <span className="text-muted-foreground italic">loading…</span>
                                ) : effectiveTax.hsnCode ? (
                                    <><span className="font-mono font-medium">{effectiveTax.hsnCode}</span> <span className="text-muted-foreground">({taxSourceLabel(effectiveTax.hsnSource)})</span></>
                                ) : (
                                    <span className="text-muted-foreground italic">not set</span>
                                )}
                            </div>
                            <div>
                                <span className="text-muted-foreground">Taxability: </span>
                                {effectiveTax == null ? (
                                    <span className="text-muted-foreground italic">loading…</span>
                                ) : effectiveTax.taxability ? (
                                    <><span className="font-medium">{effectiveTax.taxability}</span> <span className="text-muted-foreground">({taxSourceLabel(effectiveTax.taxabilitySource)})</span></>
                                ) : (
                                    <span className="text-muted-foreground italic">not set</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
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
                            type="text" inputMode="decimal"
                            value={form.openingQty}
                            onChange={(e) => setForm((f) => ({ ...f, openingQty: e.target.value }))}
                            placeholder="0"
                        />
                        <p className="text-[11px] text-muted-foreground">In product unit.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Opening rate (₹)</Label>
                        <Input
                            type="text" inputMode="decimal"
                            value={form.openingRate}
                            onChange={(e) => setForm((f) => ({ ...f, openingRate: e.target.value }))}
                            placeholder="0.00"
                        />
                        <p className="text-[11px] text-muted-foreground">Cost per unit at books-beginning.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>As of</Label>
                        <TallyDateInput
                            value={form.openingDate}
                            onValueChange={(iso) => setForm((f) => ({ ...f, openingDate: iso }))}
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

