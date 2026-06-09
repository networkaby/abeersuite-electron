"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath } from "@/shared/lib/shop/productPublic";
import { Badge } from "@/components/ui/badge";
import { Lock, ShieldCheck } from "lucide-react";
import PortalAccountSwitcher from "@/modules/external/portal/PortalAccountSwitcher";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

export default function ShopCheckoutPage() {
    const router = useRouter();
    const lines = useShopCartStore((s) => s.lines);
    const clear = useShopCartStore((s) => s.clear);
    const activeAccountId = usePortalAccountStore((s) => s.activeAccountId);
    const accountOptions = usePortalAccountStore((s) => s.options);
    const accountLoading = usePortalAccountStore((s) => s.loading);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Config-only: which online gateway is configured (display name only, no keys).
    // The live charge is not wired yet — this just informs the customer it's coming.
    const [onlineGateway, setOnlineGateway] = useState<string | null>(null);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
        axios
            .get<{ online: { provider: string; displayName: string } | null }>("/api/shop/payment-config")
            .then((r) => setOnlineGateway(r.data.online?.displayName ?? null))
            .catch(() => setOnlineGateway(null));
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
            if (!activeAccountId) {
                setError("Sign in and select a profile before placing order.");
                setLoading(false);
                return;
            }
            // Pay-on-Delivery: create the order (lands on the orders pipeline) and
            // go straight to confirmation. Payment is collected on delivery.
            // TODO(payment-gateway): branch to an online gateway when one is live.
            const { data: order } = await axios.post<{ id: number; totalPaise: number }>("/api/shop/orders", {
                lines,
                accountId: activeAccountId,
            });
            clear();
            router.push(`/shop/order/${order.id}`);
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
                Pay on delivery · no payment needed now
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>

            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_400px] lg:items-start">
                <div className="space-y-8">
                    <Card className="border-border/80 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg">Account profile</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <PortalAccountSwitcher />
                            {accountOptions.length === 0 && !accountLoading ? (
                                <p className="text-sm text-muted-foreground">
                                    No active portal profile found. Please sign in to the customer portal first.
                                    {" "}
                                    <Link href="/login" className="text-primary underline">
                                        Sign in
                                    </Link>
                                </p>
                            ) : null}
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
                            disabled={loading || !activeAccountId}
                            onClick={() => void submit()}
                        >
                            <Lock className="size-4" />
                            {loading ? "Placing order…" : "Place COD order"}
                        </Button>
                        <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                            Pay on delivery — you’ll pay the courier when your order arrives.
                            {onlineGateway
                                ? ` Online payment via ${onlineGateway} is coming soon.`
                                : " Online payment options are coming soon."}
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </main>
    );
}
