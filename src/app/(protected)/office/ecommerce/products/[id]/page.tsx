"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProductForm from "@/modules/ecommerce/components/ProductForm";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

export default function EcommerceProductEditPage() {
    const params = useParams();
    const router = useRouter();
    const id = Number(params.id);
    const [product, setProduct] = useState<ShopProductAdmin | null>(null);
    // Deep edit = the full Inventory product master dialog (brand, warranty
    // term, category, tax…) — fields this shop-facing form doesn't expose.
    const [deepEditOpen, setDeepEditOpen] = useState(false);

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

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/office/ecommerce/products">← Products</Link>
                </Button>
                <h1 className="text-2xl font-semibold tracking-tight">Edit product</h1>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setDeepEditOpen(true)}
                >
                    <SlidersHorizontal className="size-4" />
                    Deep edit
                </Button>
            </div>
            <InvProductDialog
                open={deepEditOpen}
                onOpenChange={setDeepEditOpen}
                editId={id}
                onSaved={() => {
                    setDeepEditOpen(false);
                    load();
                    toast.success("Product master updated");
                }}
            />
            <ProductForm
                initial={product}
                submitLabel="Save changes"
                onSaved={(p) => {
                    setProduct(p);
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
