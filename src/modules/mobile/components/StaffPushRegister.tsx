"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/** The staff Android app's push plugin (phone-app, NsPushPlugin.java). */
type NativePush = { getToken: () => Promise<{ token: string }> };

/**
 * Hands the phone's Firebase token to the server each time the staff app opens,
 * so customer WhatsApp messages reach this phone with the app closed
 * (push/staffPush.ts). Every open, not once: the server re-checks the Inbox tick
 * and stamps lastSeenAt, which a later sign-out outdates. Nothing happens in a
 * browser (no native bridge).
 */
export default function StaffPushRegister() {
    const { data, status } = useSession();
    const userId = (data?.user as { id?: string } | undefined)?.id;

    useEffect(() => {
        if (status !== "authenticated" || !userId) return;
        const native = (window as { Capacitor?: { Plugins?: { NsPush?: NativePush } } }).Capacitor?.Plugins?.NsPush;
        if (!native) return;
        let tries = 0;
        // The token arrives a moment after the app starts — look again a few times.
        const timer = setInterval(async () => {
            tries += 1;
            const token = (await native.getToken().catch(() => ({ token: "" }))).token;
            if (!token && tries < 20) return;
            clearInterval(timer);
            if (!token) return;
            void fetch("/api/mobile/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            }).catch(() => {});
        }, 1500);
        return () => clearInterval(timer);
    }, [status, userId]);

    return null;
}
