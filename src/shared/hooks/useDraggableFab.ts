"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

type Pos = { x: number; y: number };

/** Below this many pixels of movement a press is still a tap, not a drag. */
const DRAG_THRESHOLD = 4;

function readPos(key: string): Pos | null {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const p = JSON.parse(raw) as Partial<Pos>;
        return typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;
    } catch {
        return null;
    }
}

const clamp = (p: Pos, w: number, h: number): Pos => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
});

/**
 * A floating round button the user can drag anywhere on screen. Until it is
 * first dragged it sits wherever its own CSS puts it; after that the spot is
 * remembered on this device under `storageKey` — one key per button, so each
 * moves on its own. The button needs `touch-none` so a drag does not scroll.
 *
 * Spread `bind` on the button and call `wasDrag()` first thing in its onClick:
 * the click that ends a drag is swallowed.
 */
export function useDraggableFab(storageKey: string) {
    const [pos, setPos] = useState<Pos | null>(null);
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; w: number; h: number; moved: boolean } | null>(null);
    const lastPos = useRef<Pos | null>(null);
    const justDragged = useRef(false);

    // Read after mount (no localStorage on the server); keep it on screen when
    // the phone turns or the window shrinks.
    useEffect(() => {
        const saved = readPos(storageKey);
        if (saved) setPos(clamp(saved, 56, 56));
        const onResize = () => setPos((p) => (p ? clamp(p, 56, 56) : p));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [storageKey]);

    const bind = {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            dragRef.current = { startX: e.clientX, startY: e.clientY, origX: r.left, origY: r.top, w: r.width, h: r.height, moved: false };
            justDragged.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: PointerEvent<HTMLElement>) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.startX;
            const dy = e.clientY - d.startY;
            if (!d.moved && Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
            d.moved = true;
            const next = clamp({ x: d.origX + dx, y: d.origY + dy }, d.w, d.h);
            lastPos.current = next;
            setPos(next);
        },
        onPointerUp: () => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d?.moved || !lastPos.current) return;
            justDragged.current = true;
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(lastPos.current));
            } catch { /* private mode — position just isn't remembered */ }
        },
        onPointerCancel: () => { dragRef.current = null; },
    };

    const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

    /** True (once) when the click being handled is the end of a drag. */
    const wasDrag = () => {
        const v = justDragged.current;
        justDragged.current = false;
        return v;
    };

    return { bind, style, wasDrag };
}
