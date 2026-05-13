import { useState, useEffect, useCallback, useRef } from "react";

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
    const [width, setWidth] = useState(defaultWidth);
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

    // Load persisted width once on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const n = parseInt(stored, 10);
                if (!isNaN(n) && n >= minWidth && n <= maxWidth) setWidth(n);
            }
        } catch {
            // localStorage unavailable (SSR / private mode)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            draggingRef.current = true;
            startXRef.current = e.clientX;
            startWidthRef.current = width;
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
                setWidth((prev) => {
                    try { localStorage.setItem(storageKey, String(prev)); } catch { /* ignore */ }
                    return prev;
                });
            };

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [width, direction, minWidth, maxWidth, storageKey],
    );

    return {
        width, setWidth,
        isDragging, dragReady,
        onMouseDown,
        onHandleMouseEnter,
        onHandleMouseLeave,
    };
}
