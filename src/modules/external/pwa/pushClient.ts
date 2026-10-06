"use client";

/**
 * Browser side of the customer app's notifications: register the service
 * worker, and turn this device's subscription on / off with /api/portal/push.
 * The server side is src/shared/lib/push/sendPush.ts.
 */

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window &&
        !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    );
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
    // updateViaCache "none": a new sw.js reaches phones on the next visit.
    return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
}

async function currentSubscription(): Promise<PushSubscription | null> {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
}

export async function readPushState(): Promise<PushState> {
    if (!pushSupported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") return "off";
    return (await currentSubscription()) ? "on" : "off";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function saveSubscription(sub: PushSubscription): Promise<Response> {
    return fetch("/api/portal/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
    });
}

/** Ask permission (must run from a tap) and save the subscription. */
export async function turnPushOn(): Promise<PushState> {
    if (!pushSupported()) return "unsupported";
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return permission === "denied" ? "denied" : "off";

    await registerServiceWorker();
    const reg = await navigator.serviceWorker.ready;
    const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));

    const res = await saveSubscription(sub);
    if (!res.ok) throw new Error("Could not save notifications");
    return "on";
}

export async function turnPushOff(): Promise<PushState> {
    if (!pushSupported()) return "unsupported";
    const sub = await currentSubscription();
    if (sub) {
        await fetch("/api/portal/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => null);
        await sub.unsubscribe().catch(() => false);
    }
    return "off";
}

/** Re-save an existing subscription, so it follows whoever is signed in now. */
export async function refreshPushSubscription(): Promise<void> {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await saveSubscription(sub).catch(() => null);
}
