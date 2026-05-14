"use client";

/* eslint-disable react-hooks/refs */
// `react-hooks/refs` flags every `cb.wrapperRef` / `cb.inputRef` / `cb.listRef`
// usage in this file. These refs come from the `useComboboxNav` hook and are
// passed to DOM elements via the `ref` prop — standard React forwarding, not
// the "read .current during render" anti-pattern the rule targets. Disabled
// file-wide so we don't pepper every JSX line with comments that don't quite
// land on the attribute the rule reports against.

/**
 * GlAccountCombobox — searchable GL account picker for journal-voucher rows.
 * Inline text input + dropdown; type to filter by code or name. No API call
 * per keystroke — parent owns the accounts list (preloaded once).
 *
 * Modeled after `InvProductCombobox` (same UX rules: inline, keyboard nav,
 * clear button, dropdown widens to fit row).
 */

import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useComboboxNav } from "@/shared/hooks";

export interface GlAccount {
    id: number;
    code: string | null;
    name: string;
    balance?: number;
    normalBalance?: "DEBIT" | "CREDIT" | null;
    group?: { id?: number; name?: string | null; type?: string | null } | null;
}

type Props = {
    /** Currently selected account id (null = nothing selected) */
    value: number | null;
    /** Called when user picks an account from the dropdown, or clears */
    onChange: (account: GlAccount | null) => void;
    /** Pre-loaded chart of accounts; parent fetches once and passes in */
    accounts: GlAccount[];
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
};

export function GlAccountCombobox({
    value, onChange, accounts,
    placeholder = "Select account",
    className = "",
    autoFocus = false,
}: Props) {
    const [query, setQuery] = useState("");

    // Sync display text when external value changes. The GL code stays in the
    // model (search filter still matches it) but is hidden from the UI.
    const selectedAccount = accounts.find((a) => a.id === value);
    const selectedLabel = selectedAccount ? selectedAccount.name : "";

    const syncQuery = useCallback(() => {
        if (selectedAccount) setQuery(selectedLabel);
        else if (!value)    setQuery("");
    }, [selectedAccount, selectedLabel, value]);
    useEffect(syncQuery, [syncQuery]);

    const q = query.trim().toLowerCase();
    const filtered = q && q !== selectedLabel.toLowerCase()
        ? accounts.filter((a) =>
            a.name.toLowerCase().includes(q) ||
            (a.code ?? "").toLowerCase().includes(q),
        )
        : accounts;

    const cb = useComboboxNav({
        count: filtered.length,
        onSelect: (i) => {
            const a = filtered[i];
            if (!a) return;
            setQuery(a.name);
            cb.setOpen(false);
            onChange(a);
        },
        onClear: () => { setQuery(""); onChange(null); },
    });

    // Prefer an ancestor dialog content (if any) over document.body so the
    // dropdown lives inside Radix Dialog's react-remove-scroll allow-list;
    // otherwise wheel / touch scrolling on the dropdown is silently blocked.
    // The dialog content has a transform (translate -50%, -50%) which makes
    // it the containing block for any `position: fixed` descendant, so coords
    // below are stored *relative to the portal target* — viewport when body,
    // or transformed-origin when dialog content.
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    useEffect(() => {
        const w = cb.wrapperRef.current;
        if (!w) return;
        const inDialog = w.closest('[data-slot="dialog-content"]') as HTMLElement | null;
        setPortalTarget(inDialog ?? document.body);
    }, [cb.wrapperRef]);

    // Portal positioning: anchor to wrapper's viewport rect. Flips up when
    // there's no room below. `maxHeight` is computed from actually-available
    // space, capped at DROPDOWN_MAX_H — few options shrinks, many options
    // scroll inside the cap and never spill past the viewport.
    const DROPDOWN_MAX_H = 288;        // hard cap (~9 rows of two-line items)
    const VIEWPORT_MARGIN = 12;        // breathing room from viewport edges
    const [pos, setPos] = useState<{
        top: number; left: number; width: number; maxHeight: number; flipUp: boolean;
    } | null>(null);
    useLayoutEffect(() => {
        if (!cb.open || !portalTarget) { setPos(null); return; }
        const wrapper = cb.wrapperRef.current;
        if (!wrapper) return;
        const measure = () => {
            const rect = wrapper.getBoundingClientRect();
            // Offset of the portal target in viewport coords. body's rect is
            // typically (0, 0) but can drift on RTL/scrolled layouts; the dialog
            // content's rect tracks its transformed top-left so we always
            // express coords relative to its origin.
            const target = portalTarget.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
            const spaceAbove = rect.top - VIEWPORT_MARGIN;
            // Flip up only when below is genuinely cramped AND above has more room.
            const flipUp = spaceBelow < 140 && spaceAbove > spaceBelow;
            const available = Math.max(80, flipUp ? spaceAbove : spaceBelow);
            const maxHeight = Math.min(DROPDOWN_MAX_H, available);
            const width = Math.max(360, rect.width);
            const anchorY = flipUp ? rect.top : rect.bottom;
            setPos({
                top: anchorY - target.top,
                left: rect.left - target.left,
                width,
                maxHeight,
                flipUp,
            });
            cb.setDropdownWidth(width);
        };
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);  // capture: catch scroll on any ancestor
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [cb.open, cb.wrapperRef, cb.setDropdownWidth, portalTarget]);

    // Wrap handleKeyDown to add Tab commit-on-exit (the generic hook intentionally
    // leaves Tab to consumers since the behaviour varies).
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (cb.open && e.key === "Tab") {
            const normalizedQuery = query.trim().toLowerCase();
            const normalizedSelected = selectedLabel.trim().toLowerCase();
            const hasTypedInput = normalizedQuery.length > 0;
            const shouldCommit = hasTypedInput && normalizedQuery !== normalizedSelected;
            if (shouldCommit && filtered[cb.highlighted]) {
                const a = filtered[cb.highlighted];
                setQuery(a.name);
                cb.setOpen(false);
                onChange(a);
            } else {
                cb.setOpen(false);
            }
            return;
        }
        cb.handleKeyDown(e);
    };

    return (
        <div ref={cb.wrapperRef} className={`relative ${className}`}>
            <input
                ref={cb.inputRef}
                type="text"
                value={query}
                autoFocus={autoFocus}
                placeholder={placeholder}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                onChange={(e) => {
                    setQuery(e.target.value);
                    cb.setHighlighted(0);
                    cb.setOpen(true);
                    if (!e.target.value) onChange(null);
                }}
                onFocus={(e) => {
                    cb.setOpen(true);
                    e.target.select();    // immediate typing replaces the label
                }}
                onBlur={cb.handleBlur}
                onKeyDown={onKeyDown}
            />

            {cb.open && portalTarget && pos && createPortal(
                <div
                    // z-[60] sits above shadcn Dialog's z-50 backdrop + footer.
                    // `overflow-hidden` clips the inner list to the wrapper's
                    // computed maxHeight, so the dropdown never spills past the
                    // viewport even with hundreds of accounts.
                    // `position: fixed` inside Radix Dialog's transformed
                    // content becomes "absolute" relative to the dialog — the
                    // top/left we feed are already in that coordinate space.
                    // For flip-up we anchor top to the input's top edge and
                    // shift up by the dropdown's own height via translateY.
                    className="fixed z-[60] mt-0.5 overflow-hidden rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{
                        top:   pos.top,
                        left:  pos.left,
                        width: pos.width,
                        maxHeight: pos.maxHeight,
                        transform: pos.flipUp ? "translateY(calc(-100% - 0.25rem))" : undefined,
                    }}
                    // Prevent the click landing on the underlying dialog backdrop
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                            No accounts match <span className="font-mono">{query}</span>
                        </div>
                    ) : (
                        // Native overflow on a sized div — shadcn ScrollArea's
                        // viewport doesn't honour a max-height parent reliably,
                        // so its scrollbar wouldn't appear with long lists.
                        <div className="overflow-y-auto" style={{ maxHeight: pos.maxHeight }}>
                            <ul ref={cb.listRef} className="divide-y divide-border">
                                {filtered.map((a, i) => (
                                    <li
                                        key={a.id}
                                        onMouseDown={() => {
                                            setQuery(a.name);
                                            cb.setOpen(false);
                                            onChange(a);
                                        }}
                                        // No onMouseEnter setHighlighted — it would trigger the
                                        // hook's scrollIntoView during wheel scrolling, snapping
                                        // the list back to whichever row the cursor was over.
                                        // Mouse users still get a :hover style from `hover:bg-accent/60`.
                                        className={`cursor-pointer px-3 py-1.5 transition-colors ${
                                            i === cb.highlighted ? "bg-accent" : "hover:bg-accent/60"
                                        }`}
                                    >
                                        <div className="flex items-baseline gap-2 min-w-0">
                                            <span className="font-medium truncate">{a.name}</span>
                                        </div>
                                        {a.group?.name && (
                                            <div className="text-[10px] text-muted-foreground truncate">
                                                {a.group.name}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>,
                portalTarget,
            )}

            {value != null && (
                <button
                    type="button"
                    onMouseDown={cb.clear}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground text-sm leading-none"
                    tabIndex={-1}
                    aria-label="Clear account"
                >
                    ×
                </button>
            )}
        </div>
    );
}
