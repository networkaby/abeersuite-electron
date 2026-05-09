"use client";

// Reusable: pressing Escape on any drilldown page navigates back via
// `router.back()` so the user returns to the report (or wherever they came
// from) without clicking. Pairs with the visible ← back button + breadcrumb.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useEscapeBack(): void {
    const router = useRouter();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // Don't intercept while typing in an input/textarea/contenteditable.
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            // Don't intercept if a Radix dialog/dropdown is open (it handles Escape itself).
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router]);
}
