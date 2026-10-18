"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { pushSupported, registerServiceWorker, urlBase64ToUint8Array } from "@/modules/external/pwa/pushClient";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { MOBILE_SCREENS, holdsScreen } from "../lib/mobileScreens";

/** The staff Android app's push plugin (phone-app, NsPushPlugin.java). */
type NativePush = { getToken: () => Promise<{ token: string }> };

const INBOX = MOBILE_SCREENS.find((s) => s.href === `${PHONE_APP_HOME}/inbox`)!;

const save = (body: unknown) =>
    fetch("/api/mobile/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

/** Android staff app: its Firebase token. Arrives a moment after start — look again a few times. */
function registerNative(native: NativePush): () => void {
    let tries = 0;
    const timer = setInterval(async () => {
        tries += 1;
        const token = (await native.getToken().catch(() => ({ token: "" }))).token;
        if (!token && tries < 20) return;
        clearInterval(timer);
        if (token) void save({ token });
    }, 1500);
    return () => clearInterval(timer);
}

/** Browser (office site, POS, phone Chrome): a web push subscription through public/sw.js.
 *  Never inside the desktop app (Electron): it has no push service, and a service
 *  worker there would get in the way of its own offline handling. */
async function registerWeb(): Promise<void> {
    if (!pushSupported() || /Electron/i.test(navigator.userAgent)) return;
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return;
    if (!(await registerServiceWorker())) return;
    const reg = await navigator.serviceWorker.ready;
    const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));
    await save(sub.toJSON());
}

/**
 * Tells the server where to reach this staff member when a customer's WhatsApp
 * message arrives with the app or tab closed (push/staffPush.ts). Runs on every
 * open, not once: the server re-checks the Inbox tick and stamps lastSeenAt,
 * which a later sign-out outdates. Only for people who may answer messages.
 * Mounted in the phone app, office and POS layouts.
 */
export default function StaffPushRegister() {
    const { data, status } = useSession();
    const user = data?.user as { id?: string; permissions?: string[] } | undefined;
    const may = !!user?.permissions && holdsScreen(user.permissions, INBOX);

    useEffect(() => {
        if (status !== "authenticated" || !user?.id || !may) return;
        const native = (window as { Capacitor?: { Plugins?: { NsPush?: NativePush } } }).Capacitor?.Plugins?.NsPush;
        if (native) return registerNative(native);
        void registerWeb().catch(() => {});
    }, [status, user?.id, may]);

    return null;
}
