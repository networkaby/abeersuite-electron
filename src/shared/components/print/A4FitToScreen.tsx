"use client";

import { useLayoutEffect } from "react";

/** The A4 sheet's width in CSS pixels (210 mm). */
const A4_PX = 794;

/**
 * Full-document A4 pages (a bill opened in a phone browser) shrink the sheet to
 * the screen's width, so the whole page reads without sideways scrolling. Screen
 * only — on paper the sheet stays true A4. Sets `--a4-fit`, read by a4Styles.
 */
export default function A4FitToScreen() {
    useLayoutEffect(() => {
        const root = document.documentElement;
        const fit = () => root.style.setProperty("--a4-fit", String(Math.min(1, root.clientWidth / A4_PX)));
        fit();
        window.addEventListener("resize", fit);
        return () => {
            window.removeEventListener("resize", fit);
            root.style.removeProperty("--a4-fit");
        };
    }, []);
    return null;
}
