"use client";

/**
 * BarcodeSvg — single-source-of-truth wrapper around `jsbarcode` for rendering
 * a CODE128 barcode into an inline <svg>. SVG (not <canvas>) so the barcode
 * stays crisp at any print DPI / zoom level.
 *
 * Used by `PrintLabelsPage`. If you need a barcode anywhere else in the app,
 * use this component — do NOT import jsbarcode directly.
 *
 * Props:
 * - `value`     — the string to encode (sku / barcode / ean / upc — anything Code128 accepts).
 * - `height`    — bar height in pixels (default 40). Width auto-scales from the value length.
 * - `showText`  — when true (default), prints the value below the bars in jsbarcode's font.
 * - `fontSize`  — font size for the readable text (default 12).
 * - `margin`    — quiet zone around the barcode (default 4).
 * - `stretch`   — when true, the barcode fills its container's width at a FIXED
 *                 height instead of scaling proportionally. Bar/space ratios are
 *                 preserved (every bar scales by the same factor), so scanning is
 *                 unaffected — but a long code no longer prints with short, thin
 *                 bars just because it has more digits. Opt-in: the default
 *                 (proportional) is what the receipt/invoice/parcel prints use.
 * - `className` — applied to the wrapping <svg>; useful for sizing in print stylesheets.
 *
 * Errors (empty value, characters outside the Code128 set) are caught and
 * rendered as a small "Invalid" placeholder so the print sheet never crashes
 * on bad data.
 */

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

type Props = {
    value:      string;
    height?:    number;
    showText?:  boolean;
    fontSize?:  number;
    margin?:    number;
    stretch?:   boolean;
    className?: string;
};

export function BarcodeSvg({
    value,
    height = 40,
    showText = true,
    fontSize = 12,
    margin = 4,
    stretch = false,
    className = "",
}: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const errorRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const svg = svgRef.current;
        const errEl = errorRef.current;
        if (!svg || !errEl) return;
        try {
            JsBarcode(svg, value || " ", {
                format:      "CODE128",
                height,
                displayValue: showText,
                fontSize,
                margin,
                // No background so the label preset (white / colored card) shows
                // through and shrink-to-fit calculations are predictable.
                background:  "transparent",
                lineColor:   "#000",
            });
            errEl.style.display = "none";
            svg.style.display = "block";
            // JsBarcode sets width/height but no viewBox, so CSS `max-width`
            // would CLIP instead of scale. Mirror the rendered size into a
            // viewBox so narrow containers (80mm thermal slips) can shrink the
            // barcode proportionally. Rendering is unchanged where it fits.
            const w = svg.getAttribute("width");
            const h = svg.getAttribute("height");
            if (w && h) svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
            // Stretch mode: drop the aspect-ratio lock so CSS can set width and
            // height independently. Horizontal scaling is uniform, so the bar to
            // space ratio the scanner reads is unchanged.
            svg.setAttribute("preserveAspectRatio", stretch ? "none" : "xMidYMid meet");
        } catch {
            svg.style.display = "none";
            errEl.style.display = "inline";
        }
    }, [value, height, showText, fontSize, margin, stretch]);

    return (
        <>
            <svg ref={svgRef} className={className} aria-label={`Barcode ${value}`} />
            <span ref={errorRef} className="text-[10px] text-destructive" style={{ display: "none" }}>
                Invalid barcode: {value}
            </span>
        </>
    );
}
