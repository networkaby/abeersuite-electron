"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, CreditCard, HandCoins, Loader2, MapPin, Truck } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import { useShopCheckout } from "@/modules/external/shop/useShopCheckout";
import { APP, appLoginPath } from "@/modules/external/shopApp/appPaths";
import { INDIA_STATE_NAMES } from "@/modules/delivery/lib/deliveryMethodConfig";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { parseDigitsInput } from "@/shared/lib/format";
import { SHOP_APP_HIDE_REWARDS } from "@/shared/lib/device/shopApp";

const STEPS = ["Address", "Delivery", "Summary"] as const;

const field = "h-12 w-full rounded-xl border bg-background px-3 text-[15px] outline-none focus:border-primary";
const label = "mb-1 block text-xs font-medium text-muted-foreground";
const choice = (on: boolean) =>
    `flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background"}`;

/**
 * The app's checkout, one step per screen as in Flipkart: Address → Delivery
 * & payment → Summary, with a progress line on top and one big button at the
 * bottom. Every rule — pincode lookup, local delivery areas, courier quote,
 * payment rails, level / coupon / points, placing the order — comes from
 * useShopCheckout, the same hook as the website checkout. The phone's own
 * pickers (select) for state and area: native, and no typing.
 */
export default function AppCheckout() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const isCustomer = (session?.user as { kind?: string } | undefined)?.kind === "customer";
    const c = useShopCheckout({ onPlaced: (id) => router.replace(`${APP}/order/${id}`) });
    const [step, setStep] = useState(0);

    const back = () => (step > 0 ? setStep(step - 1) : router.back());

    // Nobody signed in, or a staff sign-in: the order needs a customer.
    if (status !== "loading" && !isCustomer) {
        return (
            <>
                <MobileHeader title="Checkout" back={back} />
                <div className="space-y-4 px-6 py-16 text-center">
                    <p className="text-lg font-semibold">Sign in to place your order</p>
                    <p className="text-sm text-muted-foreground">Your bill and order go to your account, so we need to know who you are.</p>
                    <Link href={appLoginPath(`${APP}/checkout`)} className="inline-block rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground">
                        Sign in
                    </Link>
                </div>
            </>
        );
    }
    if (c.lines.length === 0) {
        return (
            <>
                <MobileHeader title="Checkout" back={back} />
                <div className="space-y-4 px-6 py-16 text-center">
                    <p className="text-base">Your cart is empty.</p>
                    <Link href={APP} className="text-sm font-medium text-primary">
                        Continue shopping
                    </Link>
                </div>
            </>
        );
    }

    const canNext = step === 0 ? !!c.addressComplete && !!c.activeAccountId : step === 1 ? !!c.selected && c.hasRail : c.canPlace;
    const a = c.address;

    return (
        <>
            <MobileHeader title="Checkout" back={back} />
            {/* Progress: three dots joined by a line, done steps ticked. */}
            <ol className="flex items-center gap-2 border-b bg-background px-6 py-3">
                {STEPS.map((s, i) => (
                    <li key={s} className="flex flex-1 items-center gap-2 last:flex-none">
                        <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary" : "border text-muted-foreground"
                            }`}
                        >
                            {i < step ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        <span className={`text-xs ${i === step ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
                        {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-primary" : "bg-border"}`} />}
                    </li>
                ))}
            </ol>

            <div className="flex-1 space-y-4 px-4 py-4">
                {step === 0 && (
                    <>
                        <section className="flex items-center justify-between gap-3 rounded-xl border bg-background p-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium">Bill to</p>
                                <p className="text-xs text-muted-foreground">The order and its bill go to this profile.</p>
                            </div>
                            <PortalProfileSwitch />
                        </section>
                        <section className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className={label}>Full name</label>
                                <input className={field} value={a.name} onChange={(e) => c.setField("name")(e.target.value)} autoComplete="name" />
                            </div>
                            <div className="col-span-2">
                                <label className={label}>Mobile number</label>
                                <input
                                    className={field}
                                    value={a.phone}
                                    onChange={(e) => c.setField("phone")(parseDigitsInput(e.target.value).slice(0, 10))}
                                    inputMode="tel"
                                    autoComplete="tel-national"
                                />
                            </div>
                            <div>
                                <label className={label}>Pincode</label>
                                <input
                                    className={field}
                                    value={a.pincode}
                                    onChange={(e) => c.setField("pincode")(parseDigitsInput(e.target.value).slice(0, 6))}
                                    inputMode="numeric"
                                    autoComplete="postal-code"
                                />
                            </div>
                            <div className="flex items-end pb-3 text-xs text-muted-foreground">
                                {c.pincodeInfo && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="size-3.5" /> {c.pincodeInfo}
                                    </span>
                                )}
                            </div>
                            <div className="col-span-2">
                                <label className={label}>House no., building, street</label>
                                <input className={field} value={a.line1} onChange={(e) => c.setField("line1")(e.target.value)} autoComplete="address-line1" />
                            </div>
                            <div className="col-span-2">
                                <label className={label}>Landmark (optional)</label>
                                <input className={field} value={a.line2} onChange={(e) => c.setField("line2")(e.target.value)} autoComplete="address-line2" />
                            </div>
                            {c.localityOptions.length > 0 && (
                                <div className="col-span-2">
                                    <label className={label}>Locality / area</label>
                                    <select className={field} value={a.locality || "__none__"} onChange={(e) => c.onLocalityChange(e.target.value)}>
                                        <option value="__none__">Not listed / other</option>
                                        {c.localityOptions.map((l) => (
                                            <option key={l} value={l}>
                                                {l}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {c.hasCoverage && (
                                <div className="col-span-2">
                                    <label className={label}>Neighbourhood — for our local delivery</label>
                                    <select className={field} value={a.neighbourhood || "__none__"} onChange={(e) => c.onNeighbourhoodChange(e.target.value)}>
                                        <option value="__none__">Not my area</option>
                                        {c.neighbourhoodOptions.map((n) => (
                                            <option key={n} value={n}>
                                                {n}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className={label}>City</label>
                                <input className={field} value={a.city} onChange={(e) => c.setField("city")(e.target.value)} autoComplete="address-level2" />
                            </div>
                            <div>
                                <label className={label}>State</label>
                                <select className={field} value={a.state} onChange={(e) => c.setField("state")(e.target.value)}>
                                    <option value="">Select</option>
                                    {INDIA_STATE_NAMES.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </section>
                    </>
                )}

                {step === 1 && (
                    <>
                        <section className="space-y-2">
                            <h2 className="flex items-center gap-2 text-sm font-semibold">
                                <Truck className="size-4" /> Delivery
                            </h2>
                            {c.quoting ? (
                                <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                                    <Loader2 className="size-4 animate-spin" /> Finding delivery options…
                                </p>
                            ) : c.quoteError ? (
                                <p className="text-sm text-destructive">{c.quoteError}</p>
                            ) : (
                                c.options
                                    .filter((o) => !o.hidden)
                                    .map((o) => (
                                        <button key={o.optionId} type="button" onClick={() => c.setSelectedOptionId(o.optionId)} className={choice(o.optionId === c.selectedOptionId)}>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[15px] font-medium">{o.label}</span>
                                                {o.etaText && <span className="block text-xs text-muted-foreground">Arrives {o.etaText}</span>}
                                                {o.kind === "STORE_PICKUP" && (
                                                    <span className="block text-xs text-muted-foreground">{o.pickupNote || "Collect from our store — no delivery charge."}</span>
                                                )}
                                            </span>
                                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                                                {o.amountPaise === 0 ? <span className="text-emerald-700">FREE</span> : formatRupeesFromPaise(o.amountPaise)}
                                            </span>
                                        </button>
                                    ))
                            )}
                        </section>
                        <section className="space-y-2">
                            <h2 className="flex items-center gap-2 text-sm font-semibold">
                                <CreditCard className="size-4" /> Payment
                            </h2>
                            {c.podShown && (
                                <button type="button" onClick={() => c.setPayChoice("cod")} className={choice(c.payChoice === "cod")}>
                                    <HandCoins className="size-5 shrink-0" />
                                    <span>
                                        <span className="block text-[15px] font-medium">{c.pod?.displayName ?? "Pay on delivery"}</span>
                                        <span className="block text-xs text-muted-foreground">Pay when your order arrives.</span>
                                    </span>
                                </button>
                            )}
                            {c.onlineGateways.map((g) => (
                                <button key={g.provider} type="button" onClick={() => c.setPayChoice(g.provider)} className={choice(c.payChoice === g.provider)}>
                                    <CreditCard className="size-5 shrink-0" />
                                    <span>
                                        <span className="block text-[15px] font-medium">{g.displayName}</span>
                                        <span className="block text-xs text-muted-foreground">UPI, cards, net banking — on the next screen.</span>
                                    </span>
                                </button>
                            ))}
                            {!c.hasRail && <p className="text-sm text-muted-foreground">No payment method is available for this address.</p>}
                        </section>
                    </>
                )}

                {step === 2 && (
                    <>
                        <section className="rounded-xl border bg-background p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-medium">Deliver to {a.name}</p>
                                    <p className="text-muted-foreground">
                                        {[a.line1, a.line2, a.neighbourhood, a.locality, a.city, a.state, a.pincode].filter(Boolean).join(", ")}
                                    </p>
                                    <p className="text-muted-foreground">{a.phone}</p>
                                </div>
                                <button type="button" onClick={() => setStep(0)} className="shrink-0 text-sm font-medium text-primary">
                                    Change
                                </button>
                            </div>
                        </section>
                        <ul className="divide-y rounded-xl border bg-background">
                            {c.lines.map((l) => {
                                const p = c.byId.get(l.productId);
                                return (
                                    <li key={l.productId} className="flex gap-3 p-3">
                                        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg border bg-white">
                                            <ShopRemoteImage src={p?.galleryUrls[0] ?? p?.imageUrl} alt="" fill sizes="56px" frame="square" className="object-contain" />
                                        </span>
                                        <span className="min-w-0 flex-1 text-sm">
                                            <span className="line-clamp-2">{p?.displayName ?? "…"}</span>
                                            <span className="text-xs text-muted-foreground">Qty {l.quantity}</span>
                                        </span>
                                        <span className="shrink-0 text-sm font-semibold tabular-nums">{p ? formatRupeesFromPaise(p.pricePaise * l.quantity) : ""}</span>
                                    </li>
                                );
                            })}
                        </ul>
                        <CouponAndPoints c={c} />
                        <section className="space-y-2 rounded-xl border bg-background p-3 text-sm">
                            <h2 className="text-base font-semibold">Price details</h2>
                            <Row k="Items" v={formatRupeesFromPaise(c.total)} />
                            {c.tierDiscount > 0 && <Row k={`Level discount${c.tierPreview?.tierLabel ? ` (${c.tierPreview.tierLabel})` : ""}`} v={`−${formatRupeesFromPaise(c.tierDiscount)}`} good />}
                            {c.couponDiscount > 0 && <Row k={`Coupon (${c.tierPreview?.coupon?.code})`} v={`−${formatRupeesFromPaise(c.couponDiscount)}`} good />}
                            {c.onTopDiscount > 0 && <Row k={`On top (${c.tierPreview?.onTop?.name})`} v={`−${formatRupeesFromPaise(c.onTopDiscount)}`} good />}
                            {c.loyaltyDiscount > 0 && <Row k={`Points (${c.tierPreview?.loyalty?.redeemPoints})`} v={`−${formatRupeesFromPaise(c.loyaltyDiscount)}`} good />}
                            {(c.tierPreview?.freeGrant || c.tierPreview?.moneyGrant) && (
                                <Row k={`${c.tierPreview.freeGrant?.productName ?? c.tierPreview.moneyGrant?.productName} (gift)`} v="FREE" good />
                            )}
                            <Row k={`Delivery${c.selected ? ` · ${c.selected.label}` : ""}`} v={c.shipping === 0 ? "FREE" : formatRupeesFromPaise(c.shipping)} />
                            <div className="flex justify-between border-t pt-2 text-base font-semibold">
                                <span>Total</span>
                                <span className="tabular-nums">{formatRupeesFromPaise(c.grand)}</span>
                            </div>
                        </section>
                        {c.error && <p className="text-sm text-destructive">{c.error}</p>}
                    </>
                )}
            </div>

            {/* The step's one big button, fixed at the bottom. */}
            <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))]" aria-hidden />
            <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
                    <div className="min-w-0">
                        <p className="text-lg font-bold leading-tight tabular-nums">{formatRupeesFromPaise(step === 0 ? c.total : c.grand)}</p>
                        {step === 0 && <p className="text-xs text-muted-foreground">+ delivery</p>}
                    </div>
                    <button
                        type="button"
                        disabled={!canNext}
                        onClick={() => (step < 2 ? setStep(step + 1) : void c.submit())}
                        className="h-12 flex-1 rounded-xl bg-amber-400 text-[15px] font-semibold text-amber-950 active:bg-amber-300 disabled:opacity-50"
                    >
                        {step < 2 ? "Continue" : c.loading ? "Placing order…" : c.isCod ? "Place order" : "Place order & pay"}
                    </button>
                </div>
            </div>
        </>
    );
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 ${good ? "text-emerald-700" : ""}`}>
            <span className="min-w-0">{k}</span>
            <span className="shrink-0 tabular-nums">{v}</span>
        </div>
    );
}

/** Coupon code and loyalty points — the same preview as the website (the server re-checks both). */
function CouponAndPoints({ c }: { c: ReturnType<typeof useShopCheckout> }) {
    const loyalty = c.tierPreview?.loyalty;
    return (
        <section className="space-y-3 rounded-xl border bg-background p-3">
            <div className="flex gap-2">
                <input
                    value={c.couponDraft}
                    onChange={(e) => c.setCouponDraft(e.target.value.toUpperCase())}
                    placeholder="Coupon code"
                    className="h-11 min-w-0 flex-1 rounded-lg border px-3 text-[15px] uppercase outline-none focus:border-primary"
                />
                {c.couponCode ? (
                    <button
                        type="button"
                        onClick={() => {
                            c.setCouponCode("");
                            c.setCouponDraft("");
                        }}
                        className="h-11 rounded-lg px-3 text-sm font-medium text-destructive"
                    >
                        Remove
                    </button>
                ) : (
                    <button type="button" disabled={!c.couponDraft.trim()} onClick={() => c.setCouponCode(c.couponDraft.trim())} className="h-11 rounded-lg px-3 text-sm font-semibold text-primary disabled:opacity-50">
                        Apply
                    </button>
                )}
            </div>
            {c.couponCode && c.tierPreview?.couponError && <p className="text-xs text-destructive">{c.tierPreview.couponError}</p>}
            {c.couponDiscount > 0 && c.tierPreview?.coupon?.droppedTier && (
                <p className="text-xs text-muted-foreground">This coupon doesn&apos;t combine with the level discount — the better deal applies.</p>
            )}
            {!SHOP_APP_HIDE_REWARDS && loyalty && loyalty.balance > 0 && (
                <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                        Use my points
                        <span className="block text-xs text-muted-foreground">
                            {loyalty.balance} points · up to {c.maxRedeemablePts} on this order
                        </span>
                    </span>
                    <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={c.useMaxPoints}
                        disabled={c.maxRedeemablePts <= 0}
                        onChange={(e) => {
                            c.setUseMaxPoints(e.target.checked);
                            if (e.target.checked) {
                                c.setRedeemPts(0);
                                c.setRedeemDraft("");
                            }
                        }}
                    />
                </label>
            )}
            {c.requestedRedeemPts > 0 && loyalty?.redeemError && <p className="text-xs text-destructive">{loyalty.redeemError}</p>}
        </section>
    );
}
