"use client";

import { useCallback, useState } from "react";

/// Tracks which grid row the operator is on, so it can be highlighted.
///
/// Set on mouse-down AND on focus landing anywhere inside the row, so it works
/// for click-to-read grids and for keyboard/tab editing alike. State rather
/// than CSS :focus-within because the highlight must survive a dropdown or
/// popover closing (focus leaves the row, the operator has not).
///
/// Spread rowProps(id) on the <TableRow>/<tr>, and feed isActive(id) into
/// gridRowClass({ active }).
export function useActiveRow<T extends string | number>() {
    const [activeRowId, setActiveRowId] = useState<T | null>(null);

    const rowProps = useCallback(
        (id: T) => ({
            onMouseDown: () => setActiveRowId(id),
            onFocusCapture: () => setActiveRowId(id),
        }),
        [],
    );

    const isActive = (id: T) => activeRowId === id;

    return { activeRowId, setActiveRowId, rowProps, isActive };
}
