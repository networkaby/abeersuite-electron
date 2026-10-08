"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { INDIA_STATE_NAMES } from "@/modules/delivery/lib/deliveryMethodConfig";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { productPath } from "@/shared/lib/shop/productPublic";
import { Badge } from "@/components/ui/badge";
import { Lock, ShieldCheck, Loader2, Truck, CreditCard, HandCoins } from "lucide-react";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import { useShopCheckout } from "@/modules/external/shop/useShopCheckout";

export default function ShopCheckoutPage() {
    const router = useRouter();
    const {
        lines,
        byId,
        total,
        loading,
        error,
        activeAccountId,
        accountOptions,
        accountLoading,
        onlineGateways,
        pod,
        payChoice,
        setPayChoice,
        address,
        setField,
        pincodeValid,
        pincodeInfo,
        localityOptions,
        neighbourhoodOptions,
        hasCoverage,
        onLocalityChange,
        onNeighbourhoodChange,
        options,
        quoting,
        quoteError,
        selectedOptionId,
        setSelectedOptionId,
        selected,
        shipping,
        tierPreview,
        couponCode,
        setCouponCode,
        couponDraft,
        setCouponDraft,
        redeemPts,
        setRedeemPts,
        redeemDraft,
        setRedeemDraft,
        useMaxPoints,
        setUseMaxPoints,
        maxRedeemablePts,
        tierDiscount,
        couponDiscount,
        loyaltyDiscount,
        grand,
        podShown,
        hasRail,
        isCod,
        canPlace,
        submit,
        requestedRedeemPts,
    } = useShopCheckout({ onPlaced: (id) => router.push(`/shop/order/${id}`) });

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
                            <CardTitle className="text-lg">Billing profile</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-muted-foreground">This order and its bill go to the profile you are using.</p>
                                <PortalProfileSwitch />
                            </div>
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
                                <>
                                    <ul className="space-y-2">
                                        {options.filter((o) => !o.hidden).map((o) => {
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
                                                            {o.kind === "STORE_PICKUP" ? (
                                                                <span className="block text-xs text-muted-foreground">
                                                                    {active && o.pickupNote
                                                                        ? o.pickupNote
                                                                        : "Collect your order from our store — no delivery charge."}
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

                                    {/* DEV ONLY — couriers dropped by the dedupe/cap (never shown in production). */}
                                    {options.some((o) => o.hidden) ? (
                                        <div className="mt-3 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
                                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                                                Dev only · {options.filter((o) => o.hidden).length} courier(s) hidden by dedupe/cap
                                            </p>
                                            <ul className="space-y-1.5">
                                                {options.filter((o) => o.hidden).map((o) => {
                                                    const active = o.optionId === selectedOptionId;
                                                    return (
                                                        <li key={o.optionId}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedOptionId(o.optionId)}
                                                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition ${
                                                                    active ? "border-primary ring-1 ring-primary" : "border-border/60 opacity-70 hover:opacity-100"
                                                                }`}
                                                            >
                                                                <span className="min-w-0 text-xs">
                                                                    {o.label}{" "}
                                                                    <span className="text-muted-foreground">· {o.kind}</span>
                                                                </span>
                                                                <span className="shrink-0 text-xs font-semibold tabular-nums">
                                                                    {formatRupeesFromPaise(o.amountPaise)}
                                                                </span>
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    ) : null}
                                </>
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
                            {podShown ? (
                                <button
                                    type="button"
                                    onClick={() => setPayChoice("cod")}
                                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                        payChoice === "cod"
                                            ? "border-primary ring-1 ring-primary bg-primary/5"
                                            : "border-border hover:border-primary/50"
                                    }`}
                                >
                                    <HandCoins className="size-5 shrink-0" />
                                    <span>
                                        <span className="block text-sm font-medium">
                                            {pod?.displayName ?? "Pay on delivery"}
                                        </span>
                                        <span className="block text-xs text-muted-foreground">Pay when your order arrives.</span>
                                    </span>
                                </button>
                            ) : null}
                            {/* Each enabled online gateway is its own selectable rail (like couriers). */}
                            {onlineGateways.map((g) => (
                                <button
                                    key={g.provider}
                                    type="button"
                                    onClick={() => setPayChoice(g.provider)}
                                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                        payChoice === g.provider
                                            ? "border-primary ring-1 ring-primary bg-primary/5"
                                            : "border-border hover:border-primary/50"
                                    }`}
                                >
                                    <CreditCard className="size-5 shrink-0" />
                                    <span>
                                        <span className="block text-sm font-medium">{g.displayName}</span>
                                        <span className="block text-xs text-muted-foreground">
                                            {g.provider === "demo"
                                                ? "Demo gateway — simulate the payment on the next screen."
                                                : "Pay securely online on the next screen."}
                                        </span>
                                    </span>
                                </button>
                            ))}
                            {!hasRail ? (
                                <p className="text-sm text-muted-foreground">
                                    {pincodeValid
                                        ? "No payment method is available for this address."
                                        : "Enter your delivery address to see payment options."}
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
                                                <ShopRemoteImage src={img} alt="" fill frame="square" className="object-cover" sizes="56px" />
                                            ) : null}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <Link
                                                href={p ? productPath(p) : "/shop"}
                                                className="text-sm font-medium leading-snug hover:text-primary line-clamp-2"
                                            >
                                                {p?.displayName ?? `Product #${l.productId}`}
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
                        {tierDiscount > 0 && (
                            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                                <span>
                                    Level discount{tierPreview?.tierLabel ? ` (${tierPreview.tierLabel})` : ""}
                                </span>
                                <span className="tabular-nums font-medium">−{formatRupeesFromPaise(tierDiscount)}</span>
                            </div>
                        )}
                        {couponDiscount > 0 && tierPreview?.coupon && (
                            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                                <span>Coupon ({tierPreview.coupon.code})</span>
                                <span className="tabular-nums font-medium">−{formatRupeesFromPaise(couponDiscount)}</span>
                            </div>
                        )}
                        {loyaltyDiscount > 0 && tierPreview?.loyalty && (
                            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                                <span>Loyalty ({tierPreview.loyalty.redeemPoints} pts)</span>
                                <span className="tabular-nums font-medium">−{formatRupeesFromPaise(loyaltyDiscount)}</span>
                            </div>
                        )}
                        {/* Free item (Free item / Buy X get Y) — added to the
                            order as a zero-price line; no ₹ row. An independent
                            grant (rule 1) or a money-slot grant (rule 3). */}
                        {(tierPreview?.freeGrant || tierPreview?.moneyGrant) && (
                            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                                <span>
                                    {tierPreview.freeGrant?.productName ?? tierPreview.moneyGrant?.productName}
                                    {(tierPreview.freeGrant?.freeQty ?? tierPreview.moneyGrant?.freeQty ?? 0) > 1
                                        ? ` × ${tierPreview.freeGrant?.freeQty ?? tierPreview.moneyGrant?.freeQty}`
                                        : ""}{" "}
                                    FREE
                                </span>
                                <span className="tabular-nums font-medium">FREE</span>
                            </div>
                        )}
                        {/* Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO
                            on top: a ₹ discount never guard-clamped. */}
                        {tierPreview?.onTop && (
                            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                                <span>On top ({tierPreview.onTop.name})</span>
                                <span className="tabular-nums font-medium">−{formatRupeesFromPaise(tierPreview.onTop.discountPaise)}</span>
                            </div>
                        )}
                        {/* Coupon code — logged-in only (benefits need an identified
                            customer). Server validates; errors show inline. */}
                        {activeAccountId ? (
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={couponDraft}
                                        onChange={(e) => setCouponDraft(e.target.value.toUpperCase())}
                                        placeholder="Coupon code"
                                        className="h-8 text-xs"
                                    />
                                    {couponCode ? (
                                        <Button
                                            type="button" variant="outline" size="sm" className="h-8"
                                            onClick={() => { setCouponCode(""); setCouponDraft(""); }}
                                        >
                                            Remove
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button" variant="outline" size="sm" className="h-8"
                                            disabled={!couponDraft.trim()}
                                            onClick={() => setCouponCode(couponDraft.trim())}
                                        >
                                            Apply
                                        </Button>
                                    )}
                                </div>
                                {couponCode && tierPreview?.couponError ? (
                                    <p className="text-xs text-destructive">{tierPreview.couponError}</p>
                                ) : null}
                                {couponDiscount > 0 && tierPreview?.coupon?.droppedTier ? (
                                    <p className="text-[11px] text-muted-foreground">
                                        This coupon doesn&apos;t combine with the level discount — the better deal applies.
                                    </p>
                                ) : null}
                                {/* Loyalty points — shown once the programme is live and the
                                    customer has a balance. Server clamps to the cart ceiling. */}
                                {tierPreview?.loyalty && tierPreview.loyalty.balance > 0 ? (
                                    <div className="space-y-1 pt-1">
                                        <p className="text-xs text-muted-foreground">
                                            You have <span className="font-medium text-foreground">{tierPreview.loyalty.balance} points</span>
                                            {maxRedeemablePts > 0
                                                ? <> — up to {maxRedeemablePts} usable on this order (₹{(tierPreview.loyalty.redeemValue * maxRedeemablePts).toFixed(0)})</>
                                                : null}
                                        </p>
                                        {/* Tick to apply the maximum usable points — tracks the live
                                            ceiling (recomputed as the coupon/cart change it) instead of
                                            a fixed number typed once. */}
                                        <label className="flex items-center gap-2 text-xs">
                                            <Checkbox
                                                checked={useMaxPoints}
                                                disabled={maxRedeemablePts <= 0}
                                                onCheckedChange={(checked) => {
                                                    const on = checked === true;
                                                    setUseMaxPoints(on);
                                                    if (on) { setRedeemPts(0); setRedeemDraft(""); }
                                                }}
                                            />
                                            Use maximum points
                                            {maxRedeemablePts > 0 ? ` (${maxRedeemablePts} pts)` : ""}
                                        </label>
                                        {!useMaxPoints && (
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    value={redeemDraft}
                                                    onChange={(e) => setRedeemDraft(e.target.value.replace(/\D/g, ""))}
                                                    placeholder="Points to use"
                                                    inputMode="numeric"
                                                    className="h-8 text-xs"
                                                />
                                                {redeemPts > 0 ? (
                                                    <Button
                                                        type="button" variant="outline" size="sm" className="h-8"
                                                        onClick={() => { setRedeemPts(0); setRedeemDraft(""); }}
                                                    >
                                                        Remove
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        type="button" variant="outline" size="sm" className="h-8"
                                                        disabled={!redeemDraft || parseInt(redeemDraft, 10) <= 0}
                                                        onClick={() => setRedeemPts(parseInt(redeemDraft, 10) || 0)}
                                                    >
                                                        Use points
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                        {requestedRedeemPts > 0 && tierPreview.loyalty.redeemError ? (
                                            <p className="text-xs text-destructive">{tierPreview.loyalty.redeemError}</p>
                                        ) : null}
                                        {!useMaxPoints && redeemPts > 0 && tierPreview.loyalty.redeemPoints > 0 && tierPreview.loyalty.redeemPoints < redeemPts ? (
                                            <p className="text-[11px] text-muted-foreground">
                                                Clamped to {tierPreview.loyalty.redeemPoints} points (order limit).
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
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
                                : isCod
                                  ? "Place order"
                                  : "Place order & pay online"}
                        </Button>
                        <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                            {isCod
                                ? `Pay on delivery — you’ll pay ${selected ? "the courier" : ""} when your order arrives.`
                                : "You’ll complete payment on the next screen."}
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </main>
    );
}
