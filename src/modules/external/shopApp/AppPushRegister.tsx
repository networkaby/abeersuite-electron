"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/** The Android app's push plugin (shop-app-native, NsPushPlugin.java). */
type NativePush = { getToken: () => Promise<{ token: string }> };

const SAVED_KEY = "nsShopApp.pushSaved";

/**
 * Hands the phone's push token (Firebase, from the Android app) to the server
 * for the signed-in customer, so bills and receipts reach this phone as
 * notifications. Once per phone + customer + token — a new sign-in or a
 * rotated token saves again. Nothing happens in a browser (no native bridge).
 */
export default function AppPushRegister() {
    const { data, status } = useSession();
    const user = data?.user as { kind?: string; customerId?: string } | undefined;
    const customerId = user?.kind === "customer" ? user.customerId : null;

    useEffect(() => {
        if (status !== "authenticated" || !customerId) return;
        const native = (window as { Capacitor?: { Plugins?: { NsPush?: NativePush } } }).Capacitor?.Plugins?.NsPush;
        if (!native) return;
        let tries = 0;
        let done = false;
        // The token arrives a moment after the app starts — look again a few times.
        const timer = setInterval(async () => {
            if (done) return;
            tries += 1;
            const token = (await native.getToken().catch(() => ({ token: "" }))).token;
            if (!token && tries < 20) return;
            done = true;
            clearInterval(timer);
            if (!token) return;
            const key = `${customerId}:${token}`;
            try {
                if (localStorage.getItem(SAVED_KEY) === key) return;
            } catch {
                /* storage blocked — just save again */
            }
            void fetch("/api/portal/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fcmToken: token }),
            }).then((r) => {
                if (!r.ok) return;
                try {
                    localStorage.setItem(SAVED_KEY, key);
                } catch {
                    /* fine */
                }
            });
        }, 1500);
        return () => clearInterval(timer);
    }, [status, customerId]);

    return null;
}
