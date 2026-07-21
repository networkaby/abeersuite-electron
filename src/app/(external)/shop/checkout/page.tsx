"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIA_STATE_NAMES } from "@/modules/delivery/lib/deliveryMethodConfig";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath } from "@/shared/lib/shop/productPublic";
import { Badge } from "@/components/ui/badge";
import { Lock, ShieldCheck, Loader2, Truck, CreditCard, HandCoins } from "lucide-react";
import PortalAccountSwitcher from "@/modules/external/portal/PortalAccountSwitcher";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

type ShippingOption = {
    optionId: string;
    methodId: number;
    kind: "SHIPROCKET" | "CUSTOM" | "OWN_BOY";
    serviceName?: string;
    label: string;
    amountPaise: number;
    etaText: string | null;
};

const EMPTY_ADDRESS = { name: "", phone: "", line1: "", line2: "", pincode: "", locality: "", neighbourhood: "", city: "", state: "" };

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
    // The active online gateway (if any) — enables the "Pay online" rail.
    const [onlineGateway, setOnlineGateway] = useState<{ provider: string; displayName: string } | null>(null);
    const [payMethod, setPayMethod] = useState<"COD" | "ONLINE">("COD");

    const [address, setAddress] = useState(EMPTY_ADDRESS);
    const setField = (k: keyof typeof EMPTY_ADDRESS) => (v: string) => setAddress((a) => ({ ...a, [k]: v }));

    // Live courier quote for the entered pincode + cart.
    const [options, setOptions] = useState<ShippingOption[]>([]);
    const [quoting, setQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState("");
    const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
        axios
            .get<{ online: { provider: string; displayName: string } | null }>("/api/shop/payment-config")
            .then((r) => setOnlineGateway(r.data.online ?? null))
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

    const pincodeValid = /^\d{6}$/u.test(address.pincode);
    const [pincodeInfo, setPincodeInfo] = useState<string>("");
    const [localities, setLocalities] = useState<string[]>([]);
    // Our local delivery boy's coverage for this pincode: locality → [neighbourhoods].
    const [coverage, setCoverage] = useState<Record<string, string[]>>({});

    // Load local-delivery neighbourhood coverage for the pincode (enables the
    // linked Locality ↔ Neighbourhood pickers + the Local delivery courier).
    useEffect(() => {
        if (!pincodeValid) {
            setCoverage({});
            return;
        }
        let cancelled = false;
        axios
            .get<{ localities: Record<string, string[]> }>(`/api/shop/local-coverage/${address.pincode}`)
            .then((r) => {
                if (cancelled) return;
                const cov = r.data.localities ?? {};
                setCoverage(cov);
                // Drop a stale neighbourhood if it isn't covered under the new pincode.
                setAddress((a) => {
                    const all = Object.values(cov).flat();
                    return a.neighbourhood && !all.includes(a.neighbourhood) ? { ...a, neighbourhood: "" } : a;
                });
            })
            .catch(() => {
                if (!cancelled) setCoverage({});
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, pincodeValid]);

    // Auto-fill City + State + locality options from the pincode (India Post
    // lookup). Runs whenever a valid 6-digit pincode is entered; the resolved
    // state also drives zone matching.
    useEffect(() => {
        if (!pincodeValid) {
            setPincodeInfo("");
            setLocalities([]);
            return;
        }
        let cancelled = false;
        setPincodeInfo("Detecting location…");
        axios
            .get<{ ok: boolean; city?: string; state?: string; localities?: string[] }>(`/api/shop/pincode/${address.pincode}`)
            .then((r) => {
                if (cancelled) return;
                if (r.data.ok) {
                    const locs = Array.isArray(r.data.localities) ? r.data.localities : [];
                    setLocalities(locs);
                    setAddress((a) => ({
                        ...a,
                        city: r.data.city || a.city,
                        state: r.data.state || a.state,
                        // Reset the locality when the pincode changes; auto-pick when
                        // there's only one so the customer needn't choose.
                        locality: locs.length === 1 ? locs[0] : "",
                    }));
                    setPincodeInfo(r.data.city && r.data.state ? `${r.data.city}, ${r.data.state}` : "");
                } else {
                    setLocalities([]);
                    setPincodeInfo("Couldn't detect — enter city & state.");
                }
            })
            .catch(() => {
                if (!cancelled) setPincodeInfo("");
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, pincodeValid]);

    // Fetch courier options whenever the pincode becomes valid (or the cart changes).
    useEffect(() => {
        if (!pincodeValid || lines.length === 0) {
            setOptions([]);
            setSelectedOptionId(null);
            return;
        }
        let cancelled = false;
        setQuoting(true);
        setQuoteError("");
        axios
            .post<{ options: ShippingOption[] }>("/api/shop/shipping/quote", {
                pincode: address.pincode,
                state: address.state || undefined,
                neighbourhood: address.neighbourhood || undefined,
                lines,
                cod: payMethod === "COD",
            })
            .then((r) => {
                if (cancelled) return;
                const opts = r.data.options ?? [];
                setOptions(opts);
                setSelectedOptionId(opts.length > 0 ? opts[0].optionId : null);
                if (opts.length === 0) setQuoteError("No courier serves this pincode yet.");
            })
            .catch(() => {
                if (cancelled) return;
                setOptions([]);
                setSelectedOptionId(null);
                setQuoteError("Could not fetch delivery options. Check the pincode.");
            })
            .finally(() => {
                if (!cancelled) setQuoting(false);
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, address.state, address.neighbourhood, pincodeValid, lines, payMethod]);

    // Linked Locality ↔ Neighbourhood pickers (pincode is the enabler).
    const hasCoverage = Object.keys(coverage).length > 0;
    // Locality options = India Post areas ∪ the localities we cover (so a
    // neighbourhood's parent locality is always selectable).
    const localityOptions = [...new Set([...localities, ...Object.keys(coverage)])];
    // Neighbourhood options: the selected locality's, else all covered ones.
    const neighbourhoodOptions = [
        ...new Set(address.locality && coverage[address.locality] ? coverage[address.locality] : Object.values(coverage).flat()),
    ];
    // Pick a locality → keep the neighbourhood only if still valid under it.
    const onLocalityChange = (v: string) =>
        setAddress((a) => {
            const loc = v === "__none__" ? "" : v;
            const valid = loc ? coverage[loc] ?? [] : Object.values(coverage).flat();
            return { ...a, locality: loc, neighbourhood: a.neighbourhood && valid.includes(a.neighbourhood) ? a.neighbourhood : "" };
        });
    // Pick a neighbourhood → its parent locality auto-fills.
    const onNeighbourhoodChange = (v: string) =>
        setAddress((a) => {
            const nb = v === "__none__" ? "" : v;
            const parent = nb ? Object.keys(coverage).find((l) => (coverage[l] ?? []).includes(nb)) ?? a.locality : a.locality;
            return { ...a, neighbourhood: nb, locality: parent };
        });

    const selected = options.find((o) => o.optionId === selectedOptionId) ?? null;
    const shipping = selected?.amountPaise ?? 0;
    const grand = total + shipping;

    const addressComplete =
        address.name.trim() &&
        address.phone.trim().length >= 6 &&
        address.line1.trim() &&
        address.city.trim() &&
        address.state.trim() &&
        pincodeValid;

    const canPlace = !!activeAccountId && !!addressComplete && !!selected && !loading;

    const submit = async () => {
        setLoading(true);
        setError("");
        try {
            if (!activeAccountId) {
                setError("Sign in and select a profile before placing order.");
                setLoading(false);
                return;
            }
            if (!selected) {
                setError("Choose a delivery option.");
                setLoading(false);
                return;
            }
            const { data: order } = await axios.post<{ id: number }>("/api/shop/orders", {
                lines,
                accountId: activeAccountId,
                shippingAddress: {
                    name: address.name.trim(),
                    phone: address.phone.trim(),
                    line1: address.line1.trim(),
                    line2: address.line2.trim() || null,
                    locality: address.locality.trim() || null,
                    neighbourhood: address.neighbourhood.trim() || null,
                    city: address.city.trim(),
                    state: address.state.trim(),
                    pincode: address.pincode.trim(),
                },
                optionId: selected.optionId,
                paymentMethod: payMethod,
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
                                    No active portal profile found. Please sign in to the customer portal first.{" "}
                                    <Link href="/login?callbackUrl=/shop/checkout" className="text-primary underline">
                                        Sign in
                                    </Link>
                                </p>
                            ) : null}
                        </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg">Delivery address</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label>Full name</Label>
                                <Input value={address.name} onChange={(e) => setField("name")(e.target.value)} />
                            </div>
                            <div className="grid gap-2">
                                <Label>Phone</Label>
                                <Input value={address.phone} onChange={(e) => setField("phone")(e.target.value)} inputMode="tel" />
                            </div>
                            <div className="grid gap-2 sm:col-span-2">
                                <Label>Address line 1</Label>
                                <Input value={address.line1} onChange={(e) => setField("line1")(e.target.value)} />
                            </div>
                            <div className="grid gap-2 sm:col-span-2">
                                <Label>Address line 2 (optional)</Label>
                                <Input value={address.line2} onChange={(e) => setField("line2")(e.target.value)} />
                            </div>
                            <div className="grid gap-2">
                                <Label>Pincode</Label>
                                <Input
                                    value={address.pincode}
                                    onChange={(e) => setField("pincode")(e.target.value.replace(/\D/gu, "").slice(0, 6))}
                                    inputMode="numeric"
                                    placeholder="6-digit — city & state auto-fill"
                                />
                                {pincodeInfo ? <p className="text-xs text-muted-foreground">{pincodeInfo}</p> : null}
                            </div>
                            <div className="grid gap-2">
                                <Label>Locality / area</Label>
                                <Select
                                    value={address.locality || "__none__"}
                                    onValueChange={onLocalityChange}
                                    disabled={localityOptions.length === 0}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder={localityOptions.length ? "Select locality" : "Enter pincode first"} />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-72">
                                        <SelectItem value="__none__">Not listed / other</SelectItem>
                                        {localityOptions.map((l) => (
                                            <SelectItem key={l} value={l}>{l}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {hasCoverage ? (
                                <div className="grid gap-2 sm:col-span-2">
                                    <Label>Neighbourhood (for local delivery)</Label>
                                    <Select value={address.neighbourhood || "__none__"} onValueChange={onNeighbourhoodChange}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select your neighbourhood" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72">
                                            <SelectItem value="__none__">Not my area</SelectItem>
                                            {neighbourhoodOptions.map((n) => (
                                                <SelectItem key={n} value={n}>{n}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        We deliver locally here — pick your neighbourhood to see the local delivery option.
                                    </p>
                                </div>
                            ) : null}
                            <div className="grid gap-2">
                                <Label>City</Label>
                                <Input value={address.city} onChange={(e) => setField("city")(e.target.value)} />
                            </div>
                            <div className="grid gap-2">
                                <Label>State</Label>
                                <Select value={address.state} onValueChange={(v) => setField("state")(v)}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select state" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INDIA_STATE_NAMES.map((s) => (
                                            <SelectItem key={s} value={s}>{s}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Truck className="size-5" /> Delivery method
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {!pincodeValid ? (
                                <p className="text-sm text-muted-foreground">
                                    Enter a valid pincode to see delivery options and charges.
                                </p>
                            ) : quoting ? (
                                <p className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Loader2 className="size-4 animate-spin" /> Fetching couriers…
                                </p>
                            ) : quoteError ? (
                                <p className="text-sm text-destructive">{quoteError}</p>
                            ) : (
                                <ul className="space-y-2">
                                    {options.map((o) => {
                                        const active = o.optionId === selectedOptionId;
                                        return (
                                            <li key={o.optionId}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedOptionId(o.optionId)}
                                                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                                                        active
                                                            ? "border-primary ring-1 ring-primary bg-primary/5"
                                                            : "border-border hover:border-primary/50"
                                                    }`}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block text-sm font-medium">{o.label}</span>
                                                        {o.etaText ? (
                                                            <span className="block text-xs text-muted-foreground">
                                                                Est. {o.etaText}
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                    <span className="text-sm font-semibold tabular-nums shrink-0">
                                                        {o.amountPaise === 0 ? (
                                                            <Badge variant="secondary">FREE</Badge>
                                                        ) : (
                                                            formatRupeesFromPaise(o.amountPaise)
                                                        )}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-border/80 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <CreditCard className="size-5" /> Payment
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <button
                                type="button"
                                onClick={() => setPayMethod("COD")}
                                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                    payMethod === "COD"
                                        ? "border-primary ring-1 ring-primary bg-primary/5"
                                        : "border-border hover:border-primary/50"
                                }`}
                            >
                                <HandCoins className="size-5 shrink-0" />
                                <span>
                                    <span className="block text-sm font-medium">Cash on delivery</span>
                                    <span className="block text-xs text-muted-foreground">Pay when your order arrives.</span>
                                </span>
                            </button>
                            {onlineGateway ? (
                                <button
                                    type="button"
                                    onClick={() => setPayMethod("ONLINE")}
                                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                        payMethod === "ONLINE"
                                            ? "border-primary ring-1 ring-primary bg-primary/5"
                                            : "border-border hover:border-primary/50"
                                    }`}
                                >
                                    <CreditCard className="size-5 shrink-0" />
                                    <span>
                                        <span className="block text-sm font-medium">
                                            Pay online · {onlineGateway.displayName}
                                        </span>
                                        <span className="block text-xs text-muted-foreground">
                                            {onlineGateway.provider === "demo"
                                                ? "Demo gateway — simulate the payment on the next screen."
                                                : "Pay securely online."}
                                        </span>
                                    </span>
                                </button>
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
                                            {p ? formatRupeesFromPaise(p.pricePaise * l.quantity) : ""}
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
                            <span className="text-muted-foreground">
                                Shipping{selected ? ` · ${selected.label}` : ""}
                            </span>
                            <span className="tabular-nums font-medium">
                                {!selected ? (
                                    <span className="text-muted-foreground">—</span>
                                ) : shipping === 0 ? (
                                    <Badge variant="secondary">FREE</Badge>
                                ) : (
                                    formatRupeesFromPaise(shipping)
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
                            disabled={!canPlace}
                            onClick={() => void submit()}
                        >
                            <Lock className="size-4" />
                            {loading
                                ? "Placing order…"
                                : payMethod === "ONLINE"
                                  ? "Place order & pay online"
                                  : "Place COD order"}
                        </Button>
                        <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                            {payMethod === "ONLINE"
                                ? "You’ll complete payment on the next screen."
                                : `Pay on delivery — you’ll pay ${selected ? "the courier" : ""} when your order arrives.`}
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </main>
    );
}
