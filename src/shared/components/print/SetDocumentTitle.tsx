"use client";

import { useEffect } from "react";

/**
 * Sets `document.title` for standalone print documents (receipt / shipping
 * slip / coupon / gift-card routes). These pages render into the app's
 * normal root layout `<body>` — not their own `<html>/<head>` — so there's
 * no `<title>` tag to hand-write; this is what gives the print dialog and
 * "Save as PDF" a sensible default filename instead of the app's own title.
 */
export default function SetDocumentTitle({ title }: { title: string }) {
    useEffect(() => {
        document.title = title;
    }, [title]);
    return null;
}
