"use client";

/**
 * The POS Messages drawer and the new-message popup talk through two window
 * events, so neither imports the other:
 *
 *  - `requestOpenChat(phone)` — the popup's ↗ asks whoever holds a Messages
 *    drawer (the POS screen) to open that chat in place. Returns false when
 *    nobody took it, and the caller goes to the office Messages page instead.
 *  - `setChatDrawerOpen(open)` / `useChatDrawerOpen()` — while the drawer is
 *    up, the popup and its bubble hide: the drawer already shows everything.
 */

import { useEffect, useState } from "react";

const OPEN_CHAT = "messages:open-chat";
const DRAWER_STATE = "messages:drawer-open";

let drawerOpen = false;

export function requestOpenChat(phone: string): boolean {
    const e = new CustomEvent<{ phone: string }>(OPEN_CHAT, { detail: { phone }, cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
}

/** Take open-chat requests; the handler runs only while `enabled`. */
export function useOpenChatRequests(handler: (phone: string) => void, enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const h = (e: Event) => {
            e.preventDefault();
            handler((e as CustomEvent<{ phone: string }>).detail.phone);
        };
        window.addEventListener(OPEN_CHAT, h);
        return () => window.removeEventListener(OPEN_CHAT, h);
    }, [handler, enabled]);
}

export function setChatDrawerOpen(open: boolean) {
    drawerOpen = open;
    window.dispatchEvent(new CustomEvent(DRAWER_STATE));
}

export function useChatDrawerOpen(): boolean {
    const [open, setOpen] = useState(drawerOpen);
    useEffect(() => {
        const h = () => setOpen(drawerOpen);
        window.addEventListener(DRAWER_STATE, h);
        h();
        return () => window.removeEventListener(DRAWER_STATE, h);
    }, []);
    return open;
}
