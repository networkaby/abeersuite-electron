"use client";

import { useEffectEvent, useLayoutEffect, useState, type RefObject } from "react";

/** Where a portalled dropdown sits, in the portal target's own coordinates. */
export type DropdownPos = { top: number; left: number; width: number; maxHeight: number; flipUp: boolean };

/** What the caller decides about a dropdown, given the box it hangs from. */
export type DropdownPlacement = {
    /** Hard cap on the list height. */
    maxHeight: number;
    /** Flip up when less than this is free below (and more is free above). */
    flipBelow: number;
    /** Never squeeze the list below this, even when the viewport is cramped. */
    minHeight: number;
    /** Width and left edge (viewport coords) for the box at `rect`. */
    size: (rect: DOMRect, wrapper: HTMLElement) => { width: number; left: number };
};

const VIEWPORT_MARGIN = 12;   // breathing room from viewport edges

/**
 * Portal target + position for a combobox's dropdown list, measured from the page.
 *
 * The target is the surrounding Radix dialog content when there is one, so the
 * list lives inside its react-remove-scroll allow-list (otherwise wheel / touch
 * scrolling on it is silently blocked); else document.body. The dialog content
 * has a transform, which makes it the containing block for a `position: fixed`
 * child, so `pos` is stored RELATIVE TO THE TARGET — viewport when body.
 *
 * Measured in a layout effect, before the browser paints, and again on resize
 * and on scroll of any ancestor. Closed, it returns nulls; the last measurement
 * is never painted on a re-open because the layout effect re-measures first.
 *
 *   const { target, pos } = useDropdownPortal(cb.open, cb.wrapperRef, PLACEMENT);
 *   {target && pos && createPortal(<div style={{ top: pos.top, … }} />, target)}
 *
 * `placement` is read when measuring, so an inline object is fine.
 */
export function useDropdownPortal(
    open: boolean,
    wrapperRef: RefObject<HTMLElement | null>,
    placement: DropdownPlacement,
): { target: HTMLElement | null; pos: DropdownPos | null } {
    const [measured, setMeasured] = useState<{ target: HTMLElement; pos: DropdownPos } | null>(null);
    const place = useEffectEvent((wrapper: HTMLElement) => {
        const target = (wrapper.closest('[data-slot="dialog-content"]') as HTMLElement | null) ?? document.body;
        const rect = wrapper.getBoundingClientRect();
        // body's rect is usually (0, 0) but can drift on RTL / scrolled layouts;
        // the dialog content's tracks its transformed top-left.
        const origin = target.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = rect.top - VIEWPORT_MARGIN;
        // Flip up only when below is genuinely cramped AND above has more room.
        const flipUp = spaceBelow < placement.flipBelow && spaceAbove > spaceBelow;
        const maxHeight = Math.min(placement.maxHeight, Math.max(placement.minHeight, flipUp ? spaceAbove : spaceBelow));
        const { width, left } = placement.size(rect, wrapper);
        const anchorY = flipUp ? rect.top : rect.bottom;
        setMeasured({ target, pos: { top: anchorY - origin.top, left: left - origin.left, width, maxHeight, flipUp } });
    });

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        if (!open || !wrapper) return;
        const measure = () => place(wrapper);
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);   // capture: catch scroll on any ancestor
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [open, wrapperRef]);

    return open && measured ? measured : { target: null, pos: null };
}
