"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The A4 sheet's width in CSS pixels (210 mm). */
const A4_PX = 794;

/** The sheet's element — what Download / Share capture (AppDocActions). */
export const APP_DOC_SHEET_ID = "app-doc-sheet";

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
        // Measured inside the padding: the sheet fits the space it actually has.
        <div className="bg-muted/40 p-2">
            <div ref={box} className="w-full overflow-hidden">
                <div id={APP_DOC_SHEET_ID} style={{ width: A4_PX, zoom }} className="bg-white shadow-sm">
                    {children}
                </div>
            </div>
        </div>
    );
}
