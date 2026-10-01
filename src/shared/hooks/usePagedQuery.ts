"use client";

/**
 * A server-paged list whose page number belongs to the filters it was turned for.
 *
 * The screens this replaces each kept `page` in its own state and fetched by
 * hand, which went wrong two ways:
 *
 *   • A filter change read TWICE. The fetch ran for the new filters on the old
 *     page (page 3 of a list that may now have one page), then an effect reset
 *     the page to 1 and it ran again — and whichever reply landed last won.
 *   • Nothing told a late reply from the current one, so a slower answer for
 *     the previous search or dates could land over the newer one.
 *
 * Here the page is derived: it is stored WITH the filters it was chosen under,
 * and reads as 1 the moment the filters differ. One render, one URL, one read.
 * The read itself is `useApiResource`, which drops a reply for a URL the screen
 * has already left and keeps the rows on screen through a realtime refresh.
 *
 * `params` is everything except the page — empty values are left out of the
 * URL. Pass `path: null` to hold the read (nothing to ask yet).
 */

import { useCallback, useState } from "react";
import type { Topic } from "@/shared/lib/realtime/topics";
import { useApiResource } from "./useApiResource";

type Params = Record<string, string | number | null | undefined>;

export function usePagedQuery<T>(
    path: string | null,
    params: Params,
    opts: { topics?: readonly Topic[] } = {},
) {
    const key = toQuery(params);

    const [turned, setTurned] = useState<{ key: string; page: number }>({ key, page: 1 });
    const page = turned.key === key ? turned.page : 1;
    const setPage = useCallback((next: number | ((current: number) => number)) => {
        setTurned((cur) => {
            const base = cur.key === key ? cur.page : 1;
            return { key, page: typeof next === "function" ? next(base) : next };
        });
    }, [key]);

    const url = path === null ? null : `${path}?${key}${key ? "&" : ""}page=${page}`;
    const resource = useApiResource<T>(url, { topics: opts.topics });
    return { ...resource, page, setPage };
}

function toQuery(params: Params): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== "") search.set(k, String(v));
    }
    return search.toString();
}
