"use client";

import { useState } from "react";

/**
 * True on the render where `value` differs from the one this hook saw last.
 *
 * For "reset some state when a prop changes" — a dialog opening, another record
 * picked — done WHILE rendering, the way React recommends
 * (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
 * React re-runs the component straight away with the new state, before anything
 * paints, so the old values never flash. An effect would paint them first, then
 * render a second time.
 *
 *   const justOpened = useValueChange(open, false) && open;
 *   if (justOpened) { setNote(""); setAmount(""); }
 *
 * `initial` is what counts as "already seen" on the first render: pass `false`
 * for an `open` flag so a dialog mounted open resets too; leave it out to mean
 * "the first value is not a change". Compared with Object.is — pass a primitive
 * or a stable key, never an object rebuilt every render.
 *
 * Only set THIS component's state under it. A form library's reset(), a store
 * write or a request still belongs in an effect.
 */
export function useValueChange<T>(value: T, ...initial: [T] | []): boolean {
    const [seen, setSeen] = useState<T>(initial.length ? initial[0] as T : value);
    if (Object.is(seen, value)) return false;
    setSeen(value);
    return true;
}
