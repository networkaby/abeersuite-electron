"use client";

/**
 * GlAccountCombobox — searchable GL account picker for journal-voucher rows.
 * Inline text input + dropdown; type to filter by code or name. No API call
 * per keystroke — parent owns the accounts list (preloaded once).
 *
 * Modeled after `InvProductCombobox` (same UX rules: inline, keyboard nav,
 * clear button, dropdown widens to fit row).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

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
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [dropdownWidth, setDropdownWidth] = useState<number | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Match dropdown width to the wrapper (or expand a bit so two-line items fit)
    useEffect(() => {
        if (!open) return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const measure = () => {
            const rect = wrapper.getBoundingClientRect();
            setDropdownWidth(Math.max(360, rect.width));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);

    // Sync display text when external value changes
    const selectedAccount = accounts.find((a) => a.id === value);
    const selectedLabel = selectedAccount
        ? (selectedAccount.code ? `${selectedAccount.code} — ${selectedAccount.name}` : selectedAccount.name)
        : "";

    const syncQuery = useCallback(() => {
        if (selectedAccount) setQuery(selectedLabel);
        else if (!value)    setQuery("");
    }, [selectedAccount, selectedLabel, value]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(syncQuery, [syncQuery]);

    const q = query.trim().toLowerCase();
    const filtered = q && q !== selectedLabel.toLowerCase()
        ? accounts.filter((a) =>
            a.name.toLowerCase().includes(q) ||
            (a.code ?? "").toLowerCase().includes(q),
        )
        : accounts;

    const pick = useCallback((a: GlAccount) => {
        setQuery(a.code ? `${a.code} — ${a.name}` : a.name);
        setOpen(false);
        onChange(a);
    }, [onChange]);

    const clear = useCallback(() => {
        setQuery("");
        setOpen(false);
        onChange(null);
        inputRef.current?.focus();
    }, [onChange]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open) { if (e.key !== "Escape") setOpen(true); return; }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[highlighted]) pick(filtered[highlighted]);
        } else if (e.key === "Escape") {
            e.stopPropagation();        // don't bubble to dialog Esc handler
            setOpen(false);
        }
    };

    // Scroll highlighted item into view
    useEffect(() => {
        const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
        item?.scrollIntoView({ block: "nearest" });
    }, [highlighted]);

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <input
                ref={inputRef}
                type="text"
                value={query}
                autoFocus={autoFocus}
                placeholder={placeholder}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted(0);
                    setOpen(true);
                    if (!e.target.value) onChange(null);
                }}
                onFocus={(e) => {
                    setOpen(true);
                    e.target.select();    // immediate typing replaces the label
                }}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={handleKeyDown}
            />

            {open && (
                <div
                    className="absolute left-0 top-full z-50 mt-0.5 rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{ width: dropdownWidth ?? 360 }}
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                            No accounts match <span className="font-mono">{query}</span>
                        </div>
                    ) : (
                        <ScrollArea className="max-h-72 h-72">
                            <ul ref={listRef} className="divide-y divide-border">
                                {filtered.map((a, i) => (
                                    <li
                                        key={a.id}
                                        onMouseDown={() => pick(a)}
                                        onMouseEnter={() => setHighlighted(i)}
                                        className={`cursor-pointer px-3 py-1.5 transition-colors ${
                                            i === highlighted ? "bg-accent" : "hover:bg-accent/60"
                                        }`}
                                    >
                                        <div className="flex items-baseline gap-2 min-w-0">
                                            {a.code && <span className="font-mono text-[11px] text-muted-foreground shrink-0">{a.code}</span>}
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
                        </ScrollArea>
                    )}
                </div>
            )}

            {value != null && (
                <button
                    type="button"
                    onMouseDown={clear}
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
