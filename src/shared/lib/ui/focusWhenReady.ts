// Put the cursor in a box once it can actually take it — instead of guessing a
// delay (`setTimeout(() => ref.current?.focus(), 60)`) and hoping the box has
// rendered, the dialog over it has closed and nothing has taken focus back.
//
// Waits one tick first (a closing dialog hands focus back to its trigger on a
// timeout; we must land after that), then checks every frame until the element
// exists, is on screen and is enabled. After focusing it confirms on the next
// frame that focus stayed — a combobox or focus trap that pulls it back gets one
// more try. Gives up quietly after ~1s, so a box that never appears costs nothing.
//
// A component handle (anything with its own `focus()`, e.g. the party picker's)
// is waited on until it exists, then trusted to place focus itself.

type Focusable = HTMLElement | { focus: () => void };
type Target = Focusable | null | undefined;

const MAX_FRAMES = 60;

function ready(el: Target): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected || el.getClientRects().length === 0) return false;
    return !(el as HTMLInputElement).disabled && !el.closest("[inert]");
}

/** Focus (and with `select`, select the text of) the element `get` returns, as
 *  soon as it can take focus. `get` is re-read every frame, so pass a ref read
 *  or a query, not the element itself. Returns a cancel function. */
export function focusWhenReady(get: () => Target, opts: { select?: boolean } = {}): () => void {
    let cancelled = false;
    let frames = 0;
    let raf = 0;

    const focus = (el: HTMLElement) => {
        el.focus();
        if (opts.select) (el as HTMLInputElement).select?.();
    };

    const tryFocus = () => {
        if (cancelled || frames++ > MAX_FRAMES) return;
        const el = get();
        if (el && !(el instanceof HTMLElement)) { el.focus(); return; }
        if (!ready(el)) { raf = requestAnimationFrame(tryFocus); return; }
        focus(el);
        // One look a frame later: if something pulled focus away, take it back once.
        raf = requestAnimationFrame(() => {
            if (!cancelled && document.activeElement !== el && ready(el)) focus(el);
        });
    };

    const timer = setTimeout(tryFocus, 0);
    return () => { cancelled = true; clearTimeout(timer); cancelAnimationFrame(raf); };
}
