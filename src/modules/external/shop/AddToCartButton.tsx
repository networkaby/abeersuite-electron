"use client";

import { Button } from "@/components/ui/button";
import { useShopCartStore } from "@/store/external/shopCartStore";

export default function AddToCartButton({ productId }: { productId: number }) {
    const add = useShopCartStore((s) => s.add);

    return (
        <Button type="button" size="sm" variant="secondary" onClick={() => add(productId, 1)}>
            Add to cart
        </Button>
    );
}
