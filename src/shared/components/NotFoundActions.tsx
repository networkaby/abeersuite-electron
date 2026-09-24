"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * The two ways out of a 404.
 *
 * "Back" is the one people actually want — they mistyped, or followed a link to a
 * screen that no longer exists, and the screen they came from is still fine. But a
 * desktop window opened straight onto a dead URL has no history to go back to, and
 * `router.back()` there does nothing at all — a button that silently does nothing is
 * worse than no button. So we only offer Back once the browser tells us there IS
 * somewhere to go back to (checked after mount, because `window.history` does not
 * exist while rendering on the server).
 *
 * `homeHref` is decided by the build variant on the server — see not-found.tsx.
 */
const noSubscribe = () => () => {};

export default function NotFoundActions({ homeHref }: { homeHref: string }) {
    const router = useRouter();
    const canGoBack = useSyncExternalStore(
        noSubscribe,
        () => window.history.length > 1,
        () => false,
    );

    return (
        <div className="flex flex-wrap items-center justify-center gap-3">
            {canGoBack && (
                <Button onClick={() => router.back()} autoFocus>
                    Go Back
                </Button>
            )}
            <Button asChild variant={canGoBack ? "outline" : "default"}>
                <Link href={homeHref}>{homeHref === "/" ? "Home" : "Go to Office"}</Link>
            </Button>
        </div>
    );
}
