"use client";

import { useState } from "react";
import { BOARD_COLUMN_PAGE } from "@/shared/lib/constants/paging";

/**
 * Caps each board column at BOARD_COLUMN_PAGE cards, with "Show more" adding
 * another page. Keeps a long Closed column from drawing hundreds of cards.
 */
export function useColumnCap() {
    const [limits, setLimits] = useState<Record<string, number>>({});
    return function cap<T>(columnId: string, items: T[]) {
        const limit = limits[columnId] ?? BOARD_COLUMN_PAGE;
        return {
            shown: items.slice(0, limit),
            hidden: Math.max(0, items.length - limit),
            showMore: () => setLimits((l) => ({ ...l, [columnId]: limit + BOARD_COLUMN_PAGE })),
        };
    };
}
