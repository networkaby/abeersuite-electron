"use client";

import { useSyncExternalStore } from "react";

// Small things the app remembers on the phone only — the delivery pincode and
// recently viewed products. Storage can be blocked (private mode); every read and
// write survives that and the app simply forgets.

const PIN_KEY = "nsShopApp.pincode";
const RECENT_KEY = "nsShopApp.recentlyViewed";
const RECENT_MAX = 12;
const listeners = new Set<() => void>();

function read(key: string): string {
    try {
        return localStorage.getItem(key) ?? "";
    } catch {
        return "";
    }
}
function write(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* storage blocked — nothing remembered */
    }
    listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
}

/** The delivery pincode the customer gave us last ("" when none). */
export function useSavedPincode(): string {
    return useSyncExternalStore(subscribe, () => read(PIN_KEY), () => "");
}
export function savePincode(pin: string) {
    if (/^\d{6}$/.test(pin)) write(PIN_KEY, pin);
}

/** Product ids viewed most recently first, as a comma list (a stable snapshot). */
export function useRecentlyViewedRaw(): string {
    return useSyncExternalStore(subscribe, () => read(RECENT_KEY), () => "");
}
export function noteViewed(productId: number) {
    const ids = read(RECENT_KEY).split(",").filter(Boolean).map(Number).filter((n) => n !== productId);
    write(RECENT_KEY, [productId, ...ids].slice(0, RECENT_MAX).join(","));
}
