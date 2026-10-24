import { useState, useCallback, useRef, useSyncExternalStore } from "react";

// The saved width is only written by this hook's own mouse-up, which also moves the
// state, so nothing ever needs to be told it changed.
const subscribeNothing = () => () => {};

function readSavedWidth(storageKey: string, minWidth: number, maxWidth: number): number | null {
    try {
        const n = parseInt(localStorage.getItem(storageKey) ?? "", 10);
        return !isNaN(n) && n >= minWidth && n <= maxWidth ? n : null;
    } catch {
        return null;   // localStorage unavailable (private mode)
    }
}

/**
 * Drag-to-resize hook for panel sidebars.
 *
 * @param storageKey  - localStorage key for persistence
 * @param defaultWidth - initial width in px
 * @param minWidth    - minimum drag width in px
 * @param maxWidth    - maximum drag width in px
 * @param direction   - "right" (left panel, drag handle on right edge)
 *                    | "left"  (right panel, drag handle on left edge)
 */
export function useResizable({
    storageKey,
    defaultWidth,
    minWidth = 48,
    maxWidth = 600,
    direction = "right",
    hoverDelay = 350,
}: {
    storageKey: string;
    defaultWidth: number;
    minWidth?: number;
    maxWidth?: number;
    direction?: "right" | "left";
    /** ms to hover before the drag handle becomes active (shows cursor + highlight) */
    hoverDelay?: number;
}) {
    // The server (and the hydrating first pass) has no localStorage, so it renders
    // the default; the browser then switches to the saved width — no mismatch.
    const saved = useSyncExternalStore(
        subscribeNothing,
        () => readSavedWidth(storageKey, minWidth, maxWidth),
        () => null,
    );
    const [dragWidth, setWidth] = useState<number | null>(null);
    const width = dragWidth ?? saved ?? defaultWidth;
    const [isDragging, setIsDragging] = useState(false);
    const [dragReady, setDragReady] = useState(false);
    const draggingRef = useRef(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onHandleMouseEnter = useCallback(() => {
        hoverTimerRef.current = setTimeout(() => setDragReady(true), hoverDelay);
    }, [hoverDelay]);

    const onHandleMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        if (!draggingRef.current) setDragReady(false);
    }, []);

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            draggingRef.current = true;
            startXRef.current = e.clientX;
            startWidthRef.current = width;
            let latestWidth = width;
            setIsDragging(true);

            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";

            const onMove = (ev: MouseEvent) => {
                if (!draggingRef.current) return;
                const delta =
                    direction === "right"
                        ? ev.clientX - startXRef.current   // drag right → wider
                        : startXRef.current - ev.clientX;  // drag left  → wider
                const next = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
                latestWidth = next;
                setWidth(next);
            };

            const onUp = () => {
                draggingRef.current = false;
                setIsDragging(false);
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                // Persist current width
                try { localStorage.setItem(storageKey, String(latestWidth)); } catch { /* ignore */ }
            };

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [width, direction, minWidth, maxWidth, storageKey],
    );

    return {
        width,
        isDragging, dragReady,
        onMouseDown,
        onHandleMouseEnter,
        onHandleMouseLeave,
    };
}
