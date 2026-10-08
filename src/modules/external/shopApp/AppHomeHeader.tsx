"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, MapPin, Search, ShoppingCart, ChevronDown } from "lucide-react";
import ShopBrandMark from "@/modules/external/shop/ShopBrandMark";
import AppBottomSheet from "@/modules/external/shopApp/AppBottomSheet";
import { useCartCount } from "@/modules/external/shopApp/CustomerAppShell";
import { savePincode, useSavedPincode } from "@/modules/external/shopApp/appDevicePrefs";
import { APP } from "@/modules/external/shopApp/appPaths";
import { parseDigitsInput } from "@/shared/lib/format";

const iconButton = "relative flex size-10 items-center justify-center rounded-full text-primary-foreground active:bg-white/15";

/**
 * Home's top bar, Flipkart-style: brand colour, the logo on a white chip,
 * "Deliver to <pincode>", wishlist and cart; under it the search box — the
 * whole bar stays on screen while Home scrolls.
 */
export default function AppHomeHeader() {
    const cartCount = useCartCount();
    const pin = useSavedPincode();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");

    return (
        <header className="sticky top-0 z-20 bg-primary px-3 pb-3 pt-[calc(0.5rem+env(safe-area-inset-top))] text-primary-foreground shadow-sm">
            <div className="flex items-center gap-2">
                <span className="rounded-lg bg-white px-2 py-1">
                    <ShopBrandMark className="h-6 w-20" />
                </span>
                <button
                    type="button"
                    onClick={() => {
                        setDraft(pin);
                        setOpen(true);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-full px-2 py-1 text-left text-xs active:bg-white/15"
                >
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="truncate">{pin ? <>Deliver to <b>{pin}</b></> : "Set delivery pincode"}</span>
                    <ChevronDown className="size-3.5 shrink-0" />
                </button>
                <Link href={`${APP}/wishlist`} className={iconButton} aria-label="Wishlist">
                    <Heart className="size-5" />
                </Link>
                <Link href={`${APP}/cart`} className={iconButton} aria-label="Cart">
                    <ShoppingCart className="size-5" />
                    {cartCount > 0 && (
                        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950">
                            {cartCount}
                        </span>
                    )}
                </Link>
            </div>
            <Link href={`${APP}/search`} className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-white px-3 text-[15px] text-slate-500 active:bg-slate-50">
                <Search className="size-4 shrink-0 text-primary" />
                Search laptops, printers, CCTV…
            </Link>

            <AppBottomSheet
                open={open}
                title="Delivery pincode"
                onClose={() => setOpen(false)}
                footer={
                    <button
                        type="button"
                        disabled={draft.length !== 6}
                        onClick={() => {
                            savePincode(draft);
                            setOpen(false);
                        }}
                        className="h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
                    >
                        Save
                    </button>
                }
            >
                <div className="space-y-2 p-4 text-foreground">
                    <p className="text-sm text-muted-foreground">We use it to show delivery options at checkout.</p>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={draft}
                        onChange={(e) => setDraft(parseDigitsInput(e.target.value).slice(0, 6))}
                        placeholder="6-digit pincode"
                        className="h-12 w-full rounded-xl border px-3 text-[15px] outline-none focus:border-primary"
                    />
                </div>
            </AppBottomSheet>
        </header>
    );
}
