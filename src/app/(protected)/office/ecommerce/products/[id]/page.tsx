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
import { SlidersHorizontal, X } from "lucide-react";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

export default function EcommerceProductEditPage() {
    const params = useParams();
    const router = useRouter();
    const id = Number(params.id);
    const [product, setProduct] = useState<ShopProductAdmin | null>(null);
    // Deep edit = the full Inventory product master dialog (brand, warranty
    // term, category, tax…) — fields this shop-facing form doesn't expose.
    const [deepEditOpen, setDeepEditOpen] = useState(false);
    // Name rebuilt by a Group / Brand pick, not saved yet (ProductForm onNameChange).
    const [liveName, setLiveName] = useState<string | null>(null);

    const [dirty, setDirty] = useState(false);
    // Close → back to the list (router.back keeps its filter / page when we came from it).
    const close = useCallback(async () => {
        if ((dirty || liveName) && !(await confirmAction({ title: "Leave without saving?", confirmLabel: "Leave" }))) return;
        if (window.history.length > 1) router.back();
        else router.push("/office/ecommerce/products");
    }, [dirty, liveName, router]);

    const load = useCallback(() => {
        if (!Number.isFinite(id)) return;
        axios
            .get<ShopProductAdmin>(`/api/ecommerce/products/${id}`)
            .then((r) => setProduct(r.data))
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

    // Main barcode first, else the first scannable code.
    const barcode = (product.codes.find((c) => c.kind.toUpperCase() === "BARCODE") ?? product.codes[0])?.value ?? null;

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-3">
                <Button variant="ghost" size="sm" asChild className="shrink-0">
                    <Link href="/office/ecommerce/products">← Products</Link>
                </Button>
                <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-semibold tracking-tight break-words">
                        Edit product
                        <span className="ml-2 font-normal text-muted-foreground">· {liveName ?? product.name}</span>
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
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeepEditOpen(true)}>
                        <SlidersHorizontal className="size-4" />
                        Deep edit
                    </Button>
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
                onSaved={() => {
                    setDeepEditOpen(false);
                    setLiveName(null);
                    load();
                    toast.success("Product master updated");
                }}
            />
            <ProductForm
                initial={product}
                submitLabel="Save changes"
                onNameChange={setLiveName}
                onDirtyChange={setDirty}
                onClose={() => void close()}
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
