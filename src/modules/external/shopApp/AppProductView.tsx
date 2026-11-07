"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, Heart, MapPin, Search, Share2, ShoppingCart, Truck } from "lucide-react";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import AppProductRail from "@/modules/external/shopApp/AppProductRail";
import type { CompatRows } from "@/shared/lib/shop/compatibility";
import type { BridgeRow } from "@/shared/lib/shop/productRelations";
import { useCartCount } from "@/modules/external/shopApp/CustomerAppShell";
import { APP } from "@/modules/external/shopApp/appPaths";
import { noteViewed, savePincode, useSavedPincode } from "@/modules/external/shopApp/appDevicePrefs";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { parseDigitsInput } from "@/shared/lib/format";
import { productPath, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";

const roundButton = "flex size-10 items-center justify-center rounded-full bg-background/90 shadow-sm active:bg-muted";

/**
 * The app's product page, laid out like Flipkart's: photos edge to edge (swipe,
 * dots), Back / share / cart floating on them, then price, availability, a
 * delivery check, the specifications and description as open-and-close
 * sections, similar products — and a bar fixed at the bottom with Add to cart
 * and Buy now that never scrolls away.
 */
export default function AppProductView({
    product: p,
    similar,
    bridges = [],
    compat,
}: {
    product: ShopProductPublic;
    similar: ShopProductPublic[];
    bridges?: BridgeRow[];
    /** printer ↔ ink, razor ↔ blade (compatibility.ts). */
    compat?: CompatRows;
}) {
    const router = useRouter();
    const add = useShopCartStore((s) => s.add);
    const inCart = useShopCartStore((s) => s.lines.some((l) => l.productId === p.id));
    const wish = useShopWishlistStore((s) => s.has(p.id));
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const cartCount = useCartCount();
    // Home's "Recently viewed".
    useEffect(() => noteViewed(p.id), [p.id]);

    const photos = p.galleryUrls.length > 0 ? p.galleryUrls : p.imageUrl ? [p.imageUrl] : [];
    const [photo, setPhoto] = useState(0);
    const off = p.mrpPaise && p.mrpPaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.mrpPaise) * 100) : 0;
    const specs = Object.entries(p.specs);

    const share = async () => {
        const url = `${window.location.origin}${productPath(p)}`;
        try {
            if (navigator.share) await navigator.share({ title: p.displayName, url });
            else {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied");
            }
        } catch {
            /* the customer closed the share sheet */
        }
    };
    const addToCart = () => {
        if (!inCart) add(p.id, 1);
        toast.success(p.stockStatus === "backorder" ? "Added to cart (on order)" : "Added to cart", {
            action: { label: "View cart", onClick: () => router.push(`${APP}/cart`) },
        });
    };
    const buyNow = () => {
        if (!inCart) add(p.id, 1);
        router.push(`${APP}/checkout`);
    };

    return (
        <>
            {/* Top bar, Flipkart-style: back, a full search box, cart — stays on screen. */}
            <header className="sticky top-0 z-20 flex items-center gap-2 bg-primary/10 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur">
                <button type="button" onClick={() => router.back()} className="flex size-10 shrink-0 items-center justify-center rounded-full active:bg-black/5" aria-label="Back">
                    <ChevronLeft className="size-6" />
                </button>
                <Link
                    href={`${APP}/search`}
                    className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border-2 border-primary/60 bg-background px-3 text-[15px] text-muted-foreground"
                >
                    <Search className="size-5 shrink-0" />
                    <span className="truncate">Search for products</span>
                </Link>
                <Link href={`${APP}/cart`} className="relative flex size-10 shrink-0 items-center justify-center rounded-full active:bg-black/5" aria-label="Cart">
                    <ShoppingCart className="size-6" />
                    {cartCount > 0 && (
                        <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                            {cartCount}
                        </span>
                    )}
                </Link>
            </header>

            {/* Photos, edge to edge. */}
            <div className="relative bg-white">
                <ul
                    onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
                    className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    {(photos.length > 0 ? photos : [null]).map((u, i) => (
                        <li key={`${u}-${i}`} className="relative aspect-square w-full shrink-0 snap-center">
                            <ShopRemoteImage src={u} alt={i === 0 ? p.displayName : ""} fill sizes="100vw" frame="square" className="object-contain p-6" priority={i === 0} />
                        </li>
                    ))}
                </ul>
                {photos.length > 1 && (
                    <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                        {photos.map((_, i) => (
                            <span key={i} className={`h-1.5 rounded-full transition-all ${i === photo ? "w-4 bg-primary" : "w-1.5 bg-black/20"}`} />
                        ))}
                    </div>
                )}
                <button type="button" onClick={() => void share()} className={`absolute right-3 top-3 ${roundButton}`} aria-label="Share">
                    <Share2 className="size-5" />
                </button>
                <button
                    type="button"
                    onClick={() => {
                        toggleWish(p.id);
                        toast(wish ? "Removed from wishlist" : "Saved to wishlist");
                    }}
                    className={`absolute bottom-3 right-3 ${roundButton}`}
                    aria-label={wish ? "Remove from wishlist" : "Save to wishlist"}
                >
                    <Heart className={`size-5 ${wish ? "fill-rose-500 text-rose-500" : ""}`} />
                </button>
            </div>

            <div className="space-y-2 border-b bg-background px-4 py-4">
                <p className="text-xs text-muted-foreground">{p.category}</p>
                <h1 className="text-lg font-medium leading-snug">{p.displayName}</h1>
                <div className="flex flex-wrap items-baseline gap-2 pt-1">
                    {off > 0 && <span className="text-lg font-semibold text-emerald-600">↓{off}%</span>}
                    {off > 0 && p.mrpPaise && <span className="text-sm text-muted-foreground line-through tabular-nums">{formatRupeesFromPaise(p.mrpPaise)}</span>}
                    <span className="text-2xl font-bold tabular-nums">{formatRupeesFromPaise(p.pricePaise)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Inclusive of all taxes · GST invoice</p>
                {p.badge && <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{p.badge}</span>}
                <p
                    className={`text-sm font-medium ${
                        p.stockStatus === "in_stock" ? "text-emerald-700" : p.stockStatus === "backorder" ? "text-amber-700" : "text-destructive"
                    }`}
                >
                    {p.stockStatus === "in_stock"
                        ? "In stock"
                        : p.stockStatus === "backorder"
                          ? "On order — we'll get it for you; delivery takes a little longer"
                          : "Out of stock"}
                </p>
            </div>

            <DeliveryCheck />

            <div className="divide-y border-y bg-background">
                {specs.length > 0 && (
                    <Section title="Specifications" open>
                        <dl className="divide-y rounded-xl border">
                            {specs.map(([k, v]) => (
                                <div key={k} className="grid grid-cols-[40%_1fr] gap-3 px-3 py-2.5 text-sm">
                                    <dt className="text-muted-foreground">{k}</dt>
                                    <dd>{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </Section>
                )}
                {p.description && (
                    <Section title="Description" open={specs.length === 0}>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{p.description}</p>
                    </Section>
                )}
            </div>

            {[
                { title: "Made for this one", items: compat?.forThis ?? [] },
                { title: "For the same machine", items: compat?.sameFamily ?? [] },
                { title: "Works with these", items: compat?.fits ?? [] },
            ].filter((r) => r.items.length > 0).map((r) => (
                <div key={r.title} className="mt-6">
                    <AppProductRail title={r.title} products={r.items} />
                </div>
            ))}
            {similar.length > 0 && (
                <div className="py-5">
                    <AppProductRail title="Similar products" products={similar} />
                </div>
            )}

            {bridges.map((row) => (
                <div key={row.collection} className="py-5">
                    <AppProductRail title={`Goes with this · ${row.collection}`} products={row.items} />
                </div>
            ))}

            {/* Room for the fixed bar, so it never covers the last line. */}
            <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))]" aria-hidden />
            <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto flex max-w-xl gap-2 p-2">
                    {p.orderable ? (
                        <>
                            <button
                                type="button"
                                onClick={addToCart}
                                className="h-12 flex-1 rounded-xl border border-border text-[15px] font-semibold active:bg-muted"
                            >
                                {inCart ? "In cart" : "Add to cart"}
                            </button>
                            <button
                                type="button"
                                onClick={buyNow}
                                className="h-12 flex-1 rounded-xl bg-amber-400 text-[15px] font-semibold text-amber-950 active:bg-amber-300"
                            >
                                {p.stockStatus === "backorder" ? "Order now" : "Buy now"}
                            </button>
                        </>
                    ) : (
                        <p className="flex h-12 flex-1 items-center justify-center rounded-xl bg-muted text-[15px] font-medium text-muted-foreground">Out of stock</p>
                    )}
                </div>
            </div>
        </>
    );
}

/** An open-and-close section (Specifications, Description). */
function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
    return (
        <details open={open} className="group px-4">
            <summary className="flex cursor-pointer list-none items-center justify-between py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                {title}
                <ChevronDown className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="pb-4">{children}</div>
        </details>
    );
}

/**
 * "Deliver to" — the customer types a pincode and sees the town it is in. The
 * delivery choices and charge come at checkout, where the full address is known;
 * this only confirms we can find the place.
 */
function DeliveryCheck() {
    // Starts from the pincode saved on Home (or the last one checked here).
    const saved = useSavedPincode();
    const [typed, setTyped] = useState<string | null>(null);
    const pin = typed ?? saved;
    const setPin = setTyped;
    const [place, setPlace] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const check = async () => {
        if (pin.length !== 6) return;
        setBusy(true);
        try {
            const r = await fetch(`/api/shop/pincode/${pin}`).then((x) => x.json() as Promise<{ ok: boolean; city?: string; state?: string }>);
            setPlace(r.ok ? `${r.city}, ${r.state}` : "");
            if (r.ok) savePincode(pin);
        } catch {
            setPlace("");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="my-2 space-y-2 border-y bg-background px-4 py-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
                <Truck className="size-4 text-primary" /> Delivery
            </p>
            <div className="flex gap-2">
                <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border px-3">
                    <MapPin className="size-4 text-muted-foreground" />
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={pin}
                        onChange={(e) => {
                            setPin(parseDigitsInput(e.target.value).slice(0, 6));
                            setPlace(null);
                        }}
                        placeholder="Enter pincode"
                        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    />
                </label>
                <button
                    type="button"
                    onClick={() => void check()}
                    disabled={pin.length !== 6 || busy}
                    className="h-11 rounded-xl px-4 text-sm font-semibold text-primary active:bg-muted disabled:opacity-50"
                >
                    {busy ? "Checking…" : "Check"}
                </button>
            </div>
            {place === "" && <p className="text-sm text-destructive">We could not find that pincode.</p>}
            {place && (
                <p className="text-sm text-emerald-700">
                    Delivering to {place}. Delivery options and charges are shown at checkout.
                </p>
            )}
        </div>
    );
}
