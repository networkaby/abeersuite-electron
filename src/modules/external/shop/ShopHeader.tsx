"use client";

import Link from "next/link";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { Badge } from "@/components/ui/badge";

export default function ShopHeader() {
    const count = useShopCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));

    return (
        <header className="border-b border-border bg-background px-4 py-3 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-4 text-sm font-medium">
                <Link href="/shop" className="text-foreground">
                    Shop
                </Link>
                <Link href="/portal" className="text-muted-foreground hover:text-foreground">
                    Portal
                </Link>
            </nav>
            <Link href="/shop/cart" className="text-sm flex items-center gap-2">
                Cart
                {count > 0 ? <Badge variant="secondary">{count}</Badge> : null}
            </Link>
        </header>
    );
}
