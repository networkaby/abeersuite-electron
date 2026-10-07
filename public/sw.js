/*
 * Customer app service worker (shop.networkservice.in) — registered by
 * src/modules/external/pwa/ServiceWorkerRegister.tsx.
 *
 * Three jobs, nothing else:
 *  1. Show a push notification (src/shared/lib/push/sendPush.ts) even when the
 *     app is closed, and report "shown" to /api/portal/push/ack — that report is what
 *     lets a bill skip the WhatsApp copy.
 *  2. On a tap, report "clicked" and open (or focus) the page it points at.
 *  3. Page loads always come from the network — the site changes often and must
 *     never show an old copy. Only when the phone is offline does a page load
 *     get the small offline page instead of Chrome's dinosaur.
 *
 * Bump VERSION when this file changes; phones pick the new worker up on their own.
 */
const VERSION = "2026-10-07.1";
const OFFLINE_CACHE = `offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(OFFLINE_CACHE)
            .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.mode !== "navigate") return;
    event.respondWith(
        fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error()))
    );
});

function ack(id, kind) {
    if (!id) return Promise.resolve();
    return fetch("/api/portal/push/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, event: kind }),
        keepalive: true,
    }).catch(() => undefined);
}

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : "" };
    }
    const title = data.title || "Network Service";
    // Chrome requires every push to show a notification, so this always shows one.
    event.waitUntil(
        self.registration
            .showNotification(title, {
                body: data.body || "",
                tag: data.tag || undefined,
                icon: "/shop-icon-192.png",
                data: { id: data.id, url: data.url || "/portal" },
            })
            .then(() => ack(data.id, "shown"))
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const { id, url } = event.notification.data || {};
    const target = new URL(url || "/portal", self.location.origin).href;
    event.waitUntil(
        Promise.all([
            ack(id, "clicked"),
            self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
                for (const w of wins) {
                    if (w.url === target && "focus" in w) return w.focus();
                }
                return self.clients.openWindow(target);
            }),
        ])
    );
});
