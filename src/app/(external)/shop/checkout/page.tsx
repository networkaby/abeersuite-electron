"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import type { ShopProductPublic } from "@/lib/shop/product-public";
import { productPath } from "@/lib/shop/product-public";
import { Badge } from "@/components/ui/badge";
import { Lock, ShieldCheck } from "lucide-react";

export default function ShopCheckoutPage() {
    const router = useRouter();
    const lines = useShopCartStore((s) => s.lines);
    const clear = useShopCartStore((s) => s.clear);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);
    const [guestEmail, setGuestEmail] = useState("");
    const [guestPhone, setGuestPhone] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
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

    const shippingEstimate = total > 0 ? (total >= 500000 ? 0 : 9900) : 0;
    const grand = total + shippingEstimate;

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
            <main className="mx-auto max-w-lg px-4 py-16 text-center">
                <p className="text-muted-foreground">Your cart is empty.</p>
                <Button className="mt-6 rounded-full" variant="outline" onClick={() => router.push("/shop")}>
                    Back to shop
                </Button>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-6xl px-4 py-10 lg:py-14">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                Secure checkout · Razorpay when keys are configured
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>

            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_400px] lg:items-start">
                <div className="space-y-8">
                    <Card className="border-border/80 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg">Contact</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    value={guestEmail}
                                    onChange={(e) => setGuestEmail(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Mobile</Label>
                                <Input
                                    id="phone"
                                    type="tel"
                                    autoComplete="tel"
                                    placeholder="+91 …"
                                    value={guestPhone}
                                    onChange={(e) => setGuestPhone(e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Optional when logged into the customer portal — we still collect them for guest demo
                                orders.
                            </p>
                        </CardContent>
                    </Card>

                    <div className="flex flex-wrap gap-3">
                        <Button type="button" variant="outline" asChild>
                            <Link href="/shop/cart">← Back to cart</Link>
                        </Button>
                    </div>
                </div>

                <Card className="border-border/80 shadow-lg lg:sticky lg:top-24">
                    <CardHeader>
                        <CardTitle className="text-lg">Order summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <ul className="space-y-4">
                            {lines.map((l) => {
                                const p = byId.get(l.productId);
                                const img = p?.galleryUrls[0] ?? p?.imageUrl;
                                return (
                                    <li key={l.productId} className="flex gap-3">
                                        <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border bg-muted">
                                            {img ? (
                                                <ShopRemoteImage src={img} alt="" fill className="object-cover" sizes="56px" />
                                            ) : null}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <Link
                                                href={p ? productPath(p) : "/shop"}
                                                className="text-sm font-medium leading-snug hover:text-primary line-clamp-2"
                                            >
                                                {p?.name ?? `Product #${l.productId}`}
                                            </Link>
                                            <p className="text-xs text-muted-foreground mt-0.5">Qty {l.quantity}</p>
                                        </div>
                                        <p className="text-sm font-semibold tabular-nums shrink-0">
                                            {p
                                                ? formatRupeesFromPaise(p.pricePaise * l.quantity)
                                                : ""}
                                        </p>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="h-px bg-border" role="separator" />
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="tabular-nums font-medium">{formatRupeesFromPaise(total)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Shipping (est.)</span>
                            <span className="tabular-nums font-medium">
                                {shippingEstimate === 0 ? (
                                    <Badge variant="secondary">FREE</Badge>
                                ) : (
                                    formatRupeesFromPaise(shippingEstimate)
                                )}
                            </span>
                        </div>
                        <div className="flex justify-between text-lg font-bold">
                            <span>Total</span>
                            <span className="tabular-nums">{formatRupeesFromPaise(grand)}</span>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3">
                        {error ? <p className="text-sm text-destructive w-full">{error}</p> : null}
                        <Button
                            type="button"
                            size="lg"
                            className="w-full rounded-full gap-2 shadow-md"
                            disabled={loading}
                            onClick={() => void submit()}
                        >
                            <Lock className="size-4" />
                            {loading ? "Placing order…" : "Place order"}
                        </Button>
                        <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                            By placing this order you agree to demo terms. No real charge unless Razorpay is configured;
                            otherwise checkout completes as a mock payment.
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </main>
    );
}
