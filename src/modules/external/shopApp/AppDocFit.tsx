"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The A4 sheet's width in CSS pixels (210 mm). */
const A4_PX = 794;

/**
 * Shows a printable document (an A4 bill or receipt) shrunk to the phone's
 * width, so the whole page is readable at a glance without sideways scrolling —
 * pinch to zoom in as on any document viewer.
 */
export default function AppDocFit({ children }: { children: ReactNode }) {
    const box = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    useLayoutEffect(() => {
        const el = box.current;
        if (!el) return;
        const fit = () => setZoom(Math.min(1, el.clientWidth / A4_PX));
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <div ref={box} className="w-full overflow-hidden bg-muted/40 p-2">
            <div style={{ width: A4_PX, zoom }} className="bg-white shadow-sm">
                {children}
            </div>
        </div>
    );
}
