"use client";

import { useEffect } from "react";
import axios from "axios";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { QR_SLIDES_REFRESH_MS, type QrSlideProduct } from "@/modules/pos/lib/qrSlides";

/** When this PC last handed the bridge a list — the bridge keeps it on disk meanwhile. */
const LAST_PUSH_KEY = "pos:qrSlides:lastPush";

const lastPush = () => {
    try {
        return Number(localStorage.getItem(LAST_PUSH_KEY)) || 0;
    } catch {
        return 0;
    }
};

/**
 * Keeps the customer display's offer-product slides current while the POS is
 * open: on open (unless this PC sent a list in the last few hours) and every
 * few hours after. Best-effort like every display call — a failed fetch or a
 * counter with no display changes nothing on the till.
 */
export function usePosDisplaySlides() {
    useEffect(() => {
        let stopped = false;
        const push = async () => {
            try {
                const r = await axios.get<{ products: QrSlideProduct[] }>("/api/pos/display-slides");
                if (stopped) return;
                qrDisplay.products(r.data.products);
                try {
                    localStorage.setItem(LAST_PUSH_KEY, String(Date.now()));
                } catch {
                    /* the next open just asks again */
                }
            } catch {
                /* offline or signed out — the bridge keeps playing the last list */
            }
        };
        const wait = Math.max(0, lastPush() + QR_SLIDES_REFRESH_MS - Date.now());
        let timer = setTimeout(function tick() {
            void push();
            timer = setTimeout(tick, QR_SLIDES_REFRESH_MS);
        }, wait);
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, []);
}
