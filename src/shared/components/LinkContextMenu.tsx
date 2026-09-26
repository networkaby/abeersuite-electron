"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

/** Where the menu sits and which page it would open. */
export interface LinkMenuState { x: number; y: number; href: string; }

/**
 * Right-click menu for a navigation link — used by the Quick Actions bar, the
 * sidebar, the registers and the SL Search dialog, so all behave the same way.
 */
export function LinkContextMenu({ menu, onClose }: { menu: LinkMenuState | null; onClose: () => void }) {
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);
    const boxRef = useRef<HTMLDivElement>(null);

    // `position: fixed` is relative to the viewport — unless an ancestor has a
    // transform, as a centred dialog does; then it is relative to that ancestor
    // and the menu lands off the pointer. Measure where it actually sat and pull
    // it back. Reads the offset from the current style, so re-running is safe.
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!menu || !el) return;
        const want = { x: Math.min(menu.x, window.innerWidth - 200), y: Math.min(menu.y, window.innerHeight - 60) };
        const r = el.getBoundingClientRect();
        const originX = r.left - parseFloat(el.style.left || "0");
        const originY = r.top - parseFloat(el.style.top || "0");
        el.style.left = `${want.x - originX}px`;
        el.style.top = `${want.y - originY}px`;
    }, [menu]);

    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest("[data-link-ctx-menu]")) return;
            closeRef.current();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
        const onScroll = () => closeRef.current();
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        document.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, [menu]);

    if (!menu) return null;
    const x = Math.min(menu.x, window.innerWidth - 200);
    const y = Math.min(menu.y, window.innerHeight - 60);

    return (
        <div
            ref={boxRef}
            data-link-ctx-menu
            className="fixed z-50 min-w-45 rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <button
                type="button"
                onClick={() => { window.open(menu.href, "_blank", "noopener"); onClose(); }}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
            >
                Open in new window
            </button>
        </div>
    );
}

/** Menu state plus the two handlers a caller needs. */
export function useLinkContextMenu() {
    const [menu, setMenu] = useState<LinkMenuState | null>(null);
    const close = useCallback(() => setMenu(null), []);
    const openAt = useCallback((e: { clientX: number; clientY: number }, href: string) => {
        setMenu({ x: e.clientX, y: e.clientY, href });
    }, []);
    /**
     * Container-level handler: opens the menu for whichever link is under the
     * pointer, and leaves the browser's own menu alone everywhere else.
     */
    const onContainerContextMenu = useCallback((e: ReactMouseEvent) => {
        const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
        const href = anchor?.getAttribute("href");
        if (!href || href === "#") return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, href });
    }, []);
    return { menu, openAt, close, onContainerContextMenu };
}

export default LinkContextMenu;
