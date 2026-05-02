"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/lib/money-inr";

type ProductRow = { id: number; name: string; pricePaise: number };

export default function ShopCheckoutPage() {
    const router = useRouter();
    const lines = useShopCartStore((s) => s.lines);
    const clear = useShopCartStore((s) => s.clear);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [guestEmail, setGuestEmail] = useState("");
    const [guestPhone, setGuestPhone] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        axios
            .get<ProductRow[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
    const total = useMemo(() => {
        let t = 0;
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (p) t += p.pricePaise * l.quantity;
        }
        return t;
    }, [lines, byId]);

    const submit = async () => {
        setLoading(true);
        setError("");
        try {
            const { data: order } = await axios.post<{ id: number; totalPaise: number }>("/api/shop/orders", {
                lines,
                guestEmail: guestEmail.trim() || undefined,
                guestPhone: guestPhone.trim() || undefined,
            });
            const pay = await axios.post(`/api/shop/orders/${order.id}/razorpay`);
            if (pay.data?.mock) {
                clear();
                router.push(`/shop/order/${order.id}?mock=1`);
            } else {
                clear();
                router.push(`/shop/order/${order.id}`);
            }
        } catch (err: unknown) {
            const msg =
                axios.isAxiosError(err) && err.response?.data && typeof err.response.data === "object"
                    ? (err.response.data as { error?: string }).error
                    : null;
            setError(msg || "Checkout failed");
        } finally {
            setLoading(false);
        }
    };

    if (lines.length === 0) {
        return (
            <main className="mx-auto max-w-lg px-4 py-8">
                <p className="text-muted-foreground">Your cart is empty.</p>
                <Button className="mt-4" variant="outline" onClick={() => router.push("/shop")}>
                    Back to shop
                </Button>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-lg px-4 py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Checkout</h1>
            <p className="text-lg font-medium">Total: {formatRupeesFromPaise(total)}</p>
            <div className="space-y-2">
                <Label>Email (optional if logged in as customer)</Label>
                <Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" disabled={loading} onClick={() => void submit()}>
                {loading ? "Placing order…" : "Place order"}
            </Button>
        </main>
    );
}
