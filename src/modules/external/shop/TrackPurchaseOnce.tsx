"use client";

import { useEffect } from "react";
import { trackPurchase } from "@/shared/lib/shop/trackingCodes";

/**
 * Sends the Purchase event from the order page once the order is really done —
 * COD on placing, online only once paid (a gateway returns here). Remembered per
 * order in this browser, so a reload or a later visit never counts it twice.
 */
export default function TrackPurchaseOnce({ orderId, valuePaise }: { orderId: number; valuePaise: number }) {
    useEffect(() => {
        const key = `tracked-purchase:${orderId}`;
        try {
            if (localStorage.getItem(key)) return;
        } catch {
            // Storage blocked — still send; the recent-order check on the page limits repeats.
        }
        // Trackers load after the page; give them a moment so the event is not lost.
        const t = setTimeout(() => {
            trackPurchase(orderId, valuePaise / 100);
            try { localStorage.setItem(key, "1"); } catch { /* storage blocked */ }
        }, 1500);
        return () => clearTimeout(t);
    }, [orderId, valuePaise]);
    return null;
}
