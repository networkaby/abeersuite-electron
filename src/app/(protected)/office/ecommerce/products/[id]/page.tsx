"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProductForm from "@/modules/ecommerce/components/ProductForm";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { Button } from "@/components/ui/button";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { InvProductCombobox } from "@/modules/inventory/components/InvProductCombobox";
import { cachedAdminProducts, fetchAdminProducts } from "@/modules/ecommerce/lib/productListCache";
import { productStatus, type ProductStatus } from "@/modules/ecommerce/lib/productFilters";
import { DEFAULT_SHOP_PUBLISH_RULES, type ShopPublishRules } from "@/modules/ecommerce/lib/shopQualification";

/** The same stage names and colours as the products list. */
const STAGE_LOOK: Record<ProductStatus["kind"], { label: string; tone: string }> = {
    unpublished: { label: "Unpublished", tone: "border-border bg-muted/40 text-muted-foreground" },
    waiting: { label: "Start", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
    draft: { label: "Draft", tone: "border-sky-200 bg-sky-50 text-sky-700" },
    ready: { label: "Ready", tone: "border-violet-200 bg-violet-50 text-violet-700" },
    live: { label: "Published", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    pending: { label: "Pending", tone: "border-amber-200 bg-amber-50 text-amber-700" },
    attention: { label: "Attention", tone: "border-orange-200 bg-orange-50 text-orange-700" },
};

// Publish rules for the Next button's stage — read once per window.
let rulesCache: Promise<ShopPublishRules> | null = null;
const loadRules = () =>
    (rulesCache ??= axios
        .get<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules")
        .then((r) => r.data.rules)
        .catch(() => { rulesCache = null; return DEFAULT_SHOP_PUBLISH_RULES; }));
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default function EcommerceProductEditPage() {
    const params = useParams();
    const router = useRouter();
    const id = Number(params.id);
    const [product, setProduct] = useState<ShopProductAdmin | null>(null);
    // Deep edit = the full Inventory product master dialog (brand, warranty
    // term, category, tax…) — fields this shop-facing form doesn't expose.
    const [deepEditOpen, setDeepEditOpen] = useState(false);
    // Full edit = Inventory products:edit. Without it, ecommerce:product:deep-edit
    // opens a limited dialog (no tax / opening, SKU + sale price locked).
    // Neither → no button (the save would only be refused).
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canFullEdit = hasPermissionWithScope(perms, PERMISSIONS.PRODUCTS_EDIT);
    const canDeepEdit = canFullEdit || hasPermissionWithScope(perms, PERMISSIONS.ECOMMERCE_PRODUCT_DEEP_EDIT);
    // Name rebuilt by a Group / Brand pick, not saved yet (ProductForm onNameChange).
    const [liveName, setLiveName] = useState<string | null>(null);

    const [dirty, setDirty] = useState(false);
    // Close → back to the list (router.back keeps its filter / page when we came from it).
    const canLeave = useCallback(
        async () => !(dirty || liveName) || (await confirmAction({ title: "Leave without saving?", confirmLabel: "Leave" })),
        [dirty, liveName],
    );
    const close = useCallback(async () => {
        if (!(await canLeave())) return;
        if (window.history.length > 1) router.back();
        else router.push("/office/ecommerce/products");
    }, [canLeave, router]);

    // Jump: open another product picked by name / SKU / barcode (the voucher picker).
    const [pickNonce, setPickNonce] = useState(0);
    const jumpTo = useCallback(async (to: number) => {
        if (to === id) return;
        if (!(await canLeave())) { setPickNonce((n) => n + 1); return; }
        router.replace(`/office/ecommerce/products/${to}`);
    }, [id, canLeave, router]);

    // Prev / Next: the neighbouring product in the stage this one had when it was opened
    // (a Save as ready mid-run does not knock you off the Draft run). Same order
    // as the Products list; reuses its in-memory list, reads it only if empty.
    const [openStage, setOpenStage] = useState<{ id: number; kind: ProductStatus["kind"] } | null>(null);
    // The stage now (owner, 2026-11-20: "put somewhere the current stage") — follows every save.
    const [stage, setStage] = useState<ProductStatus | null>(null);
    useEffect(() => {
        if (!product) return;
        let live = true;
        void loadRules().then((rules) => { if (live) setStage(productStatus(product, rules)); });
        return () => { live = false; };
    }, [product]);
    const [nextBusy, setNextBusy] = useState(false);
    const go = useCallback(async (step: 1 | -1) => {
        if (!openStage) return;
        setNextBusy(true);
        try {
            const [list, rules] = await Promise.all([cachedAdminProducts() ?? fetchAdminProducts(), loadRules()]);
            const ids = list.filter((p) => p.id === id || productStatus(p, rules).kind === openStage.kind).map((p) => p.id);
            const others = ids.filter((x) => x !== id);
            if (!others.length) { toast.info("No other product in this stage"); return; }
            const at = ids.indexOf(id);
            let to = at >= 0 ? ids[at + step] : others[0];
            if (to == null) {
                to = step === 1 ? ids[0] : ids[ids.length - 1];
                toast.info(step === 1 ? "Back to the first product in this stage" : "On to the last product in this stage");
            }
            if (!(await canLeave())) return;
            router.replace(`/office/ecommerce/products/${to}`);
        } catch {
            toast.error("Could not load the product list");
        } finally {
            setNextBusy(false);
        }
    }, [id, openStage, canLeave, router]);

    const load = useCallback(() => {
        if (!Number.isFinite(id)) return;
        axios
            .get<ShopProductAdmin>(`/api/ecommerce/products/${id}`)
            .then((r) => {
                setProduct(r.data);
                // Stage as opened — kept for this product id only.
                void loadRules().then((rules) =>
                    setOpenStage((s) => (s?.id === r.data.id ? s : { id: r.data.id, kind: productStatus(r.data, rules).kind })));
            })
            .catch(() => setProduct(null));
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    if (!Number.isFinite(id)) {
        return <p className="text-destructive">Invalid product id.</p>;
    }

    if (!product) {
        return <p className="text-muted-foreground">Loading…</p>;
    }

    // Main barcode first, else the first scannable code, else the SKU.
    const barcode = (product.codes.find((c) => c.kind.toUpperCase() === "BARCODE") ?? product.codes[0])?.value || product.sku || null;

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-3">
                <div className="flex shrink-0 flex-col items-start gap-1">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/office/ecommerce/products">← Products</Link>
                    </Button>
                    <div className="flex gap-0.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!openStage || nextBusy}
                            title={openStage ? `Previous product in ${openStage.kind}` : "Previous product in this stage"}
                            onClick={() => void go(-1)}
                        >
                            <ChevronLeft className="size-4" />
                            Prev
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!openStage || nextBusy}
                            title={openStage ? `Next product in ${openStage.kind}` : "Next product in this stage"}
                            onClick={() => void go(1)}
                        >
                            Next
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-2">
                    <h1 className="text-2xl font-semibold tracking-tight break-words">
                        {/* No "Edit product" prefix (owner, 2026-11-22) — the name is the title. */}
                        <span>{liveName ?? product.name}</span>
                        {stage ? (
                            <span className={`ml-2 inline-block rounded border px-1.5 py-0.5 align-middle text-xs font-medium ${STAGE_LOOK[stage.kind].tone}`} title={stage.missing.length ? `Needs ${stage.missing.join(", ").toLowerCase()}` : undefined}>
                                {STAGE_LOOK[stage.kind].label}
                            </span>
                        ) : null}
                        {liveName && liveName !== product.name ? (
                            <span className="ml-2 align-middle text-xs font-normal text-amber-600">unsaved</span>
                        ) : null}
                    </h1>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                    {barcode ? (
                        // White card so the phone camera reads it in dark mode too.
                        <div className="rounded border bg-white px-1" title="Scan from the staff app to find this product">
                            <BarcodeSvg value={barcode} height={34} fontSize={11} margin={2} />
                        </div>
                    ) : null}
                    {canDeepEdit ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => setDeepEditOpen(true)}>
                            <SlidersHorizontal className="size-4" />
                            Deep edit
                        </Button>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => void close()}>
                        <X className="size-4" />
                        Close
                    </Button>
                </div>
            </div>
            <InvProductDialog
                open={deepEditOpen}
                onOpenChange={setDeepEditOpen}
                editId={id}
                limited={!canFullEdit}
                onSaved={() => {
                    setDeepEditOpen(false);
                    setLiveName(null);
                    load();
                    toast.success("Product master updated");
                }}
            />
            <ProductForm
                // Fresh form per product — the Variants "Open" link moves between ids on this page.
                key={product.id}
                initial={product}
                submitLabel="Save changes"
                onNameChange={setLiveName}
                onDirtyChange={setDirty}
                onClose={() => void close()}
                onReload={setProduct}
                skuSlot={
                    <InvProductCombobox
                        value={product.id}
                        onChange={(p) => { if (p) void jumpTo(p.id); }}
                        placeholder="Name, SKU or barcode…"
                        allowCreate={false}
                        hideCost
                        clearNonce={pickNonce}
                        showSku
                        className="flex h-9 min-w-0 items-center rounded-md border border-input bg-background px-2 font-mono"
                    />
                }
                onSaved={(p) => {
                    setProduct(p);
                    setLiveName(null);
                    toast.success("Saved");
                    router.refresh();
                }}
            />
            <div className="flex gap-2 border-t border-border pt-6">
                <Button
                    type="button"
                    variant="destructive"
                    onClick={async () => {
                        if (!(await confirmAction({ title: "Deactivate this product on the storefront?", confirmLabel: "Deactivate" }))) return;
                        try {
                            await axios.delete(`/api/ecommerce/products/${id}`);
                            toast.success("Product deactivated");
                            router.push("/office/ecommerce/products");
                        } catch {
                            toast.error("Failed");
                        }
                    }}
                >
                    Deactivate (soft delete)
                </Button>
            </div>
        </div>
    );
}
