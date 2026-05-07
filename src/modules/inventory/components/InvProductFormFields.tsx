"use client";

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

    return (
        <Tabs defaultValue="basics" className="max-h-[70vh] overflow-y-auto pr-1">
            <TabsList>
                <TabsTrigger value="basics">Basics</TabsTrigger>
                <TabsTrigger value="pricing">Pricing</TabsTrigger>
                <TabsTrigger value="stock">Stock control</TabsTrigger>
                <TabsTrigger value="online">Online listing</TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className="mt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                        <Label>SKU</Label>
                        <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} disabled={skuDisabled} className="font-mono" />
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

            <TabsContent value="pricing" className="mt-4">
                <p className="text-sm text-muted-foreground">
                    Retail / wholesale / repair-centre price fields are not yet on the schema. This tab will fill in once those columns are added to <code>InvProduct</code>.
                </p>
            </TabsContent>

            <TabsContent value="stock" className="mt-4">
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

            <TabsContent value="online" className="mt-4">
                <p className="text-sm text-muted-foreground">
                    Shop listing fields (image, slug, shop description, gallery, etc.) live on <code>InvProduct</code> but aren&apos;t exposed in this form yet. Use <em>Edit shop listing</em> from the product list to set them.
                </p>
            </TabsContent>
        </Tabs>
    );
}
