"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useShopCartStore } from "@/store/external/shopCartStore";

/**
 * Copies a signed-in customer's cart up to the server (PUT /api/portal/cart),
 * so an abandoned cart can get its one reminder email. Renders nothing.
 *
 * The device stays the source of truth — this only mirrors it, two seconds
 * after the last change, and only when the lines actually changed. Guests are
 * never copied (no email to remind them at). Checkout empties the cart, which
 * deletes the server copy.
 */
export default function CartServerSync() {
    const { data, status } = useSession();
    const isCustomer = status === "authenticated" && (data?.user as { kind?: string } | undefined)?.kind === "customer";
    const lines = useShopCartStore((s) => s.lines);
    const last = useRef<string | null>(null);

    useEffect(() => {
        if (!isCustomer) return;
        const json = JSON.stringify(lines);
        if (json === last.current) return;
        const t = setTimeout(() => {
            fetch("/api/portal/cart", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) })
                .then((r) => { if (r.ok) last.current = json; })
                .catch(() => {});
        }, 2000);
        return () => clearTimeout(t);
    }, [isCustomer, lines]);

    return null;
}
