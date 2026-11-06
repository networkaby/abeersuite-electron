"use client";

/**
 * GlAccountCombobox — searchable GL account picker for journal-voucher rows.
 * Inline text input + dropdown; type to filter by name or alias. No API call
 * per keystroke — parent owns the accounts list (preloaded once).
 *
 * Modeled after `InvProductCombobox` (same UX rules: inline, keyboard nav,
 * clear button, dropdown widens to fit row) — including its masters-on-the-fly
 * keys, so the two pickers behave alike:
 *
 *   Alt+C       make a new ledger without leaving the voucher; whatever is
 *               typed becomes its name. Enter on a no-match does the same.
 *   Ctrl+Enter  alter the ledger under the cursor (highlighted row, else the
 *               one already picked). With nothing to alter the key falls
 *               through to the form's own Save shortcut, untouched.
 */

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useComboboxNav, useDebouncedValue, useDropdownPortal, useValueChange, type DropdownPlacement } from "@/shared/hooks";
import { invalidateGlAccounts } from "@/shared/hooks/useGlAccounts";
import { aliasMatches } from "@/modules/accountancy/lib/accountAlias";
import type { EditableLedger } from "@/modules/accountancy/components/EditLedgerDialog";

// Loaded only when somebody actually makes or alters a ledger. This picker is
// on every voucher AND on the POS expenditure screen; the two master dialogs
// drag in the group picker, the particulars blocks and the opening-bills
// dialog behind them, and none of that belongs in a till's first paint.
const CreateLedgerDialog = dynamic(
    () => import("@/modules/accountancy/components/CreateLedgerDialog").then((m) => m.CreateLedgerDialog),
    { ssr: false },
);
const EditLedgerDialog = dynamic(
    () => import("@/modules/accountancy/components/EditLedgerDialog").then((m) => m.EditLedgerDialog),
    { ssr: false },
);

export interface GlAccount {
    id: number;
    name: string;
    balance?: number;
    normalBalance?: "DEBIT" | "CREDIT" | null;
    group?: { id?: number; name?: string | null; type?: string | null } | null;
    /** Party ledgers only (includeParties=true): linked contact numbers,
     *  primary first. Lets the user find a Sundry Debtor by mobile. */
    phones?: string[];
    /** Tally-style alternate names — searchable, shown under the name. */
    aliases?: string[];
    /** Ledgers of a person, company or staff member only: an A/C No is on file,
     *  so a cash Payment to them prints the party Bank Deposit Slip. Absent on
     *  every other ledger. */
    partyBank?: boolean;
    /** Party's UPI id (Bank tab) — drives the Payment voucher's scan-to-pay QR. */
    upiVpa?: string;
    /** Beneficiary name from the Bank tab, when captured. */
    upiPayee?: string;
    /** A POS counter's till cash — only a shift moves it, so office Payment /
     *  Receipt pickers hide it. Absent on every other ledger. */
    isTill?: boolean;
    // Carried through so BalanceHint can compute an "Available" figure for
    // Bank OD A/c / Credit Card ledgers — see facilityLimit.ts.
    bankJson?: unknown;
    creditCardJson?: unknown;
    // The rest of the Account row, as /api/accountancy/gl-accounts already
    // returns it. Nothing reads these for display — they are here so Ctrl+Enter
    // can hand EditLedgerDialog a COMPLETE ledger. Handing it a partial one
    // would post the missing particulars back as null and quietly wipe them.
    groupId?: number | null;
    loanJson?: unknown;
    bnplJson?: unknown;
    walletJson?: unknown;
    gatewayJson?: unknown;
    openingBalance?: number | string | null;
    openingBalanceType?: "DEBIT" | "CREDIT" | null;
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
    /** Characters the user must type before the list appears. 0 (default)
     *  opens on focus — right for a short Cash/Bank picker; a particulars
     *  row with thousands of party ledgers passes 1. */
    minChars?: number;
    /** Alt+C / Enter-on-no-match opens the new-ledger dialog. Default on. */
    allowCreate?: boolean;
    /** Ctrl+Enter opens the edit-ledger dialog. Default on. */
    allowEdit?: boolean;
    /** Re-read the caller's own account list after a ledger is made or
     *  changed here. Needed whenever `accounts` is the caller's own fetch
     *  rather than the shared chart (useGlAccounts, which this box refreshes
     *  itself): this tab never hears its own write over realtime, so nothing
     *  else would tell that list — and the page's other rows could not find
     *  the new ledger. */
    onMastersChanged?: () => void;
};

/** Typing pause before the list is filtered and drawn. */
const DEBOUNCE_MS = 150;
/** Rows drawn at most. Nobody scrolls 3,000 ledgers; rendering them all
 *  froze the input for ~2s on focus (measured 2026-09-08). */
const MAX_ROWS = 50;

const PLACEMENT: DropdownPlacement = {
    maxHeight: 288,   // hard cap (~9 rows of two-line items)
    flipBelow: 140, minHeight: 80,
    size: (rect) => ({ width: Math.max(360, rect.width), left: rect.left }),
};

export function GlAccountCombobox({
    value, onChange, accounts,
    placeholder = "Select account",
    className = "",
    autoFocus = false,
    minChars = 0,
    allowCreate = true,
    allowEdit = true,
    onMastersChanged,
}: Props) {
    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<EditableLedger | null>(null);
    // A ledger made from this box shows up INSTANTLY, before the page's list
    // has re-read (refreshMasters). It also stays reachable when the caller's list
    // is a filtered slice (Payment's expense-only rows) that would never
    // carry it — the user asked for it in this row, so this row keeps it.
    const [justCreated, setJustCreated] = useState<GlAccount[]>([]);
    const pool = useMemo(
        () => (justCreated.length === 0
            ? accounts
            : [...accounts, ...justCreated.filter((j) => !accounts.some((a) => a.id === j.id))]),
        [accounts, justCreated],
    );
    // The list filters on this, which trails `query` by DEBOUNCE_MS while the
    // user is still typing; the input itself always shows `query` at once.
    const selectedAccount = pool.find((a) => a.id === value);
    const selectedLabel = selectedAccount ? selectedAccount.name : "";

    // Sync display text when the external value changes — while rendering. Null
    // while the picked ledger is not in the list yet: whatever is typed stays.
    // Keyed on the label, so a re-read of the list leaves typing alone.
    const syncTo = selectedAccount ? selectedLabel : !value ? "" : null;
    const [query, setQuery] = useState(syncTo ?? "");
    if (useValueChange(syncTo) && syncTo !== null) setQuery(syncTo);
    const debounced = useDebouncedValue(query, DEBOUNCE_MS);

    const q = debounced.trim().toLowerCase();
    // Below the minimum the list is empty — and stays closed (see `open`).
    const belowMin = q.length < minChars;
    // Digits-only form of the query, so "9954999", "99549 99" and "+91 99549…"
    // all match the stored number however it was typed in.
    const qDigits = q.replace(/\D/g, "");
    const filtered = useMemo(() => {
        if (belowMin) return [];
        // Word by word, any order: "akram sta" finds "Akramul Jakir (Staff)".
        const words = q.split(/\s+/).filter(Boolean);
        const all = q && q !== selectedLabel.toLowerCase()
            ? pool.filter((a) =>
                words.every((w) => a.name.toLowerCase().includes(w)) ||
                aliasMatches(a.aliases, q) ||
                (qDigits.length >= 3 && (a.phones ?? []).some(
                    (p) => p.replace(/\D/g, "").includes(qDigits),
                )))
            : pool;
        return all.length > MAX_ROWS ? all.slice(0, MAX_ROWS) : all;
    }, [pool, q, qDigits, selectedLabel, belowMin]);
    const truncated = !belowMin && filtered.length === MAX_ROWS;

    const [focused, setFocused] = useState(false);
    const nav = useComboboxNav({
        count: filtered.length,
        onSelect: (i) => {
            const a = filtered[i];
            if (!a) return;
            setQuery(a.name);
            nav.setOpen(false);
            onChange(a);
        },
        onClear: () => { setQuery(""); onChange(null); },
    });
    // No dropdown without focus, and none before the minimum characters.
    const open = nav.open && focused && !belowMin;
    const { wrapperRef, inputRef, listRef } = nav;

    // Portalled into the surrounding dialog (or body) and positioned from the page (useDropdownPortal) and anchored to the input's
    // box. Flips up when there's no room below; `maxHeight` is computed from
    // actually-available space, capped — few options shrink, many scroll inside
    // the cap and never spill past the viewport.
    const { target: portalTarget, pos } = useDropdownPortal(open, wrapperRef, PLACEMENT);
    // The CTA row and the shortcut hint sit outside the scroller, so the list
    // inside it gets that much less room — otherwise the box overflows its cap.
    const chromeH = (allowCreate ? 33 : 0) + (allowEdit ? 20 : 0);

    // A master was made or changed: every list on the page that could show it
    // re-reads — the caller's own, and the shared chart when a screen holds it.
    const refreshMasters = () => {
        onMastersChanged?.();
        void invalidateGlAccounts();
    };

    const startCreate = () => { nav.setOpen(false); setCreateOpen(true); };
    // What the new ledger gets called. Blank when the box is only showing the
    // ledger already picked — otherwise Alt+C on a filled row would offer to
    // make a second ledger with that same name.
    const typedName = query.trim().toLowerCase() === selectedLabel.trim().toLowerCase()
        ? "" : query.trim();

    // Ctrl+Enter alters the row under the cursor; with the list shut, the
    // ledger already sitting in this box. The full Account row is handed over
    // — a partial one would post the untouched particulars back as null.
    const editCandidate: GlAccount | undefined =
        (open ? filtered[nav.highlighted] : undefined) ?? selectedAccount;
    const startEdit = (a: GlAccount) => {
        nav.setOpen(false);
        setEditTarget({
            id: a.id,
            name: a.name,
            aliases: a.aliases,
            groupId: a.groupId ?? a.group?.id ?? null,
            bankJson: a.bankJson,
            loanJson: a.loanJson,
            creditCardJson: a.creditCardJson,
            bnplJson: a.bnplJson,
            walletJson: a.walletJson,
            gatewayJson: a.gatewayJson,
            // Prisma sends Decimal as a string; the dialog wants a number.
            openingBalance: a.openingBalance == null ? null : Number(a.openingBalance),
            openingBalanceType: a.openingBalanceType ?? null,
        });
        setEditOpen(true);
    };

    // Wrap handleKeyDown to add Tab commit-on-exit (the generic hook intentionally
    // leaves Tab to consumers since the behaviour varies), plus the two Tally
    // masters-on-the-fly keys.
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Alt+C → new ledger, named from whatever is typed. `e.code` as well as
        // `e.key` because Alt+C reports "ç" on a Mac keyboard layout.
        if (allowCreate && e.altKey && (e.key.toLowerCase() === "c" || e.code === "KeyC")) {
            e.preventDefault();
            startCreate();
            return;
        }
        // Ctrl+Enter → alter that ledger. The voucher form binds Ctrl+Enter to
        // Save, so the event is stopped ONLY when there is really a ledger to
        // alter; otherwise Save still happens and nothing is taken away.
        if (allowEdit && (e.ctrlKey || e.metaKey) && e.key === "Enter" && editCandidate) {
            e.preventDefault();
            e.stopPropagation();
            startEdit(editCandidate);
            return;
        }
        if (open && e.key === "Tab") {
            const normalizedQuery = query.trim().toLowerCase();
            const normalizedSelected = selectedLabel.trim().toLowerCase();
            const hasTypedInput = normalizedQuery.length > 0;
            const shouldCommit = hasTypedInput && normalizedQuery !== normalizedSelected;
            if (shouldCommit && filtered[nav.highlighted]) {
                const a = filtered[nav.highlighted];
                setQuery(a.name);
                nav.setOpen(false);
                onChange(a);
            } else {
                nav.setOpen(false);
            }
            return;
        }
        // Nothing matched what was typed → Enter makes it, same as Alt+C.
        // Mirrors InvProductCombobox so a no-result is never a dead end.
        if (open && e.key === "Enter" && !e.ctrlKey && !e.metaKey
            && allowCreate && filtered.length === 0 && query.trim().length > 0) {
            e.preventDefault();
            e.stopPropagation();   // don't let the form's Enter walk focus away
            startCreate();
            return;
        }
        nav.handleKeyDown(e);
    };

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
                    nav.setHighlighted(0);
                    nav.setOpen(true);
                    if (!e.target.value) onChange(null);
                }}
                onFocus={(e) => {
                    setFocused(true);
                    nav.setOpen(true);
                    e.target.select();    // immediate typing replaces the label
                }}
                onBlur={(e) => { setFocused(false); nav.handleBlur(e); }}
                onKeyDown={onKeyDown}
            />

            {open && portalTarget && pos && createPortal(
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
                    onMouseDown={nav.dropdownMouseDown}
                >
                    {/* New-ledger CTA at the TOP — closest to the cursor, and
                        the only thing on screen when nothing matched. Acts
                        on mousedown, like the rows. */}
                    {allowCreate && (
                        <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); startCreate(); }}
                            className="flex w-full items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2 text-left text-xs font-medium text-primary hover:bg-muted"
                        >
                            <Plus size={12} />
                            <span className="truncate">
                                New ledger{typedName ? `: ${typedName}` : ""}
                            </span>
                            <span className="ml-auto shrink-0 font-normal text-muted-foreground">Alt+C</span>
                        </button>
                    )}

                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                            No accounts match <span className="font-mono">{query}</span>
                        </div>
                    ) : (
                        // Native overflow on a sized div — shadcn ScrollArea's
                        // viewport doesn't honour a max-height parent reliably,
                        // so its scrollbar wouldn't appear with long lists.
                        <div className="overflow-y-auto" style={{ maxHeight: pos.maxHeight - chromeH }}>
                            <ul ref={listRef} className="divide-y divide-border">
                                {filtered.map((a, i) => (
                                    <li
                                        key={a.id}
                                        onMouseDown={() => {
                                            setQuery(a.name);
                                            nav.setOpen(false);
                                            onChange(a);
                                        }}
                                        // No onMouseEnter setHighlighted — it would trigger the
                                        // hook's scrollIntoView during wheel scrolling, snapping
                                        // the list back to whichever row the cursor was over.
                                        // Mouse users still get a :hover style from `hover:bg-accent/60`.
                                        className={`cursor-pointer px-3 py-1.5 transition-colors ${
                                            i === nav.highlighted ? "bg-accent" : "hover:bg-accent/60"
                                        }`}
                                    >
                                        <div className="flex items-baseline gap-2 min-w-0">
                                            <span className="font-medium truncate">{a.name}</span>
                                        </div>
                                        {(a.group?.name || a.phones?.length || a.aliases?.length) && (
                                            <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground truncate">
                                                {a.group?.name && <span className="truncate">{a.group.name}</span>}
                                                {/* Primary number — tells two same-name parties apart */}
                                                {a.phones?.[0] && <span className="tabular-nums">{a.phones[0]}</span>}
                                                {/* Why this row matched when the query was an alias */}
                                                {!!a.aliases?.length && (
                                                    <span className="truncate italic">{a.aliases.join(", ")}</span>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {truncated && (
                                <div className="px-3 py-1.5 text-[11px] text-muted-foreground text-center border-t border-border">
                                    First {MAX_ROWS} shown — type more to narrow down
                                </div>
                            )}
                        </div>
                    )}

                    {allowEdit && filtered.length > 0 && (
                        <div className="border-t border-border bg-muted/40 px-3 py-1 text-[10px] text-muted-foreground">
                            Ctrl+Enter — edit the highlighted ledger
                        </div>
                    )}
                </div>,
                portalTarget,
            )}

            {value != null && (
                <button
                    type="button"
                    onMouseDown={nav.clear}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/65 hover:text-muted-foreground text-sm leading-none"
                    tabIndex={-1}
                    aria-label="Clear account"
                >
                    ×
                </button>
            )}

            {/* Masters on the fly. Both dialogs fetch the group tree once per
                tab (loadGroupOptions) — opening them from a voucher row must
                not mean another read of it for every ledger anybody makes. */}
            {allowCreate && createOpen && (
                <CreateLedgerDialog
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    defaultName={typedName}
                    onCreated={(acc) => {
                        // The whole new ledger, particulars and opening included, so
                        // Ctrl+Enter on it opens the edit box complete.
                        const made: GlAccount = { ...acc };
                        setJustCreated((xs) => [...xs.filter((x) => x.id !== made.id), made]);
                        setQuery(made.name);
                        onChange(made);
                        refreshMasters();
                    }}
                />
            )}
            {allowEdit && editOpen && (
                <EditLedgerDialog
                    open={editOpen}
                    onOpenChange={setEditOpen}
                    ledger={editTarget}
                    onSaved={(updated) => {
                        // Normally the box re-labels itself from the refreshed
                        // list. A ledger made here that the caller's filtered
                        // list never carries has no such row, so carry the new
                        // name across by hand.
                        if (updated) {
                            setJustCreated((xs) => xs.map((x) =>
                                (x.id === updated.id ? { ...x, name: updated.name } : x)));
                            if (value === updated.id) setQuery(updated.name);
                        }
                        refreshMasters();
                    }}
                />
            )}
        </div>
    );
}
