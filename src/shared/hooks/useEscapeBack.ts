"use client";

// Reusable: pressing Escape on any drilldown page navigates back via
// `router.back()` so the user returns to the report (or wherever they came
// from) without clicking. Pairs with the visible ← back button + breadcrumb.
// Skips a press an open dialog / menu / popover took, and typing in a field
// (see useEscape).

import { useRouter } from "next/navigation";
import { useEscape } from "./useEscape";

export function useEscapeBack(enabled: boolean = true): void {
    const router = useRouter();
    useEscape(() => router.back(), { enabled });
}
