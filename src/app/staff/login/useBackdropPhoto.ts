"use client";

import { useEffect, useState } from "react";

/**
 * The backdrop photo — tried in order, first one that loads wins.
 *
 * Nothing waits on it. The drawn CSS background is already a finished screen, so
 * a photo that is slow or never arrives costs a photograph, not a blank page.
 * It is loaded through an `Image` rather than set straight on the layer so the
 * fade only starts once the picture is actually decoded — half a photo sliding
 * in looks worse than none.
 */
export function useBackdropPhoto(candidates: readonly string[]): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let at = 0;
        const tryNext = () => {
            if (cancelled || at >= candidates.length) return;
            const candidate = candidates[at++];
            const img = new Image();
            img.onload = () => { if (!cancelled) setUrl(candidate); };
            img.onerror = tryNext;
            img.src = candidate;
        };
        tryNext();
        return () => { cancelled = true; };
    }, [candidates]);

    return url;
}

