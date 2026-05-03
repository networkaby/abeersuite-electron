"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProductForm from "@/modules/ecommerce/components/ProductForm";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/product-admin";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function EcommerceProductEditPage() {
    const params = useParams();
    const router = useRouter();
    const id = Number(params.id);
    const [product, setProduct] = useState<ShopProductAdmin | null>(null);

    useEffect(() => {
        if (!Number.isFinite(id)) return;
        axios
            .get<ShopProductAdmin>(`/api/ecommerce/products/${id}`)
            .then((r) => setProduct(r.data))
            .catch(() => setProduct(null));
    }, [id]);

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
            </div>
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
                        if (!confirm("Deactivate this product on the storefront?")) return;
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
