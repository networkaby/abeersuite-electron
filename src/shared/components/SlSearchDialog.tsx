"use client";

/**
 * SlSearchDialog — "the customer has the unit, but no bill, and forgot the name
 * and phone they bought it under".
 *
 * Opened from the sidebar's Workspace → SL Search (useSlSearchStore) and mounted
 * once in the office layout, so it works from any office page; the POS mounts its
 * own copy for the action rail's SL Search button (`linksInNewTab`). Staff type or scan
 * the SL no printed on the unit; the dialog shows every bill whose line note
 * carries it (with the party frozen on that bill, and how long ago it was sold —
 * the warranty question) and every repair / help ticket that mentions it.
 *
 * The search runs by itself once typing pauses, and at once on Enter — which is
 * how a barcode scanner ends every scan. After an Enter search the SL no is left
 * selected, so the next scan replaces it instead of sticking onto its end.
 */

import { useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import Link from "next/link";
import axios from "axios";
import { Loader2, ReceiptText, ScanSearch, Search, Wrench } from "lucide-react";
import { useSlSearchStore } from "@/store/slSearchStore";
import { extractApiError } from "@/shared/lib/api";
import { formatDate, parseIsoDateOnly, toDateOnly } from "@/shared/lib/format/formatDate";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";
import { partyProfileHref } from "@/shared/lib/parties/partyLink";
import { SL_SEARCH_MIN_CHARS, type SlSearchResult, type SlSearchTicket } from "@/shared/lib/search/slSearch";
import { LinkContextMenu, useLinkContextMenu } from "@/shared/components/LinkContextMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

/** A repeat of the same SL no inside this window is answered from memory. */
const CACHE_FRESH_MS = 60_000;
/** How long typing must pause before the search runs on its own. Each search is
 *  a scan of the line notes, so not on every keystroke. */
const AUTO_SEARCH_MS = 400;
const cache = new Map<string, { at: number; result: SlSearchResult }>();

/** "today" / "yesterday" / "412 days ago" — the warranty question, answered. */
function sinceLabel(isoDate: string): string {
    const day = 86_400_000;
    const days = Math.round(
        (parseIsoDateOnly(toDateOnly(new Date())).getTime() - parseIsoDateOnly(isoDate).getTime()) / day,
    );
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days} days ago`;
}

/** The note with the SL no picked out, so staff see at a glance why a line matched. */
function Highlight({ text, term }: { text: string; term: string }) {
    const at = text.toLowerCase().indexOf(term.toLowerCase());
    if (at === -1 || !term) return <>{text}</>;
    return (
        <>
            {text.slice(0, at)}
            <mark className="rounded bg-primary/20 px-0.5 text-foreground">{text.slice(at, at + term.length)}</mark>
            {text.slice(at + term.length)}
        </>
    );
}

/** A result link. A plain click opens it here and closes the dialog; a ctrl /
 *  shift / middle click leaves the dialog up behind the new tab. With `newTab`
 *  (the POS) every click opens a new tab and the dialog stays. */
function RowLink({ onNavigate, newTab, onClick, className = "hover:underline", ...rest }: ComponentProps<typeof Link> & {
    onNavigate: () => void;
    newTab?: boolean;
}) {
    return (
        <Link
            {...rest}
            {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
            className={className}
            onClick={(e) => {
                onClick?.(e);
                if (!newTab && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) onNavigate();
            }}
        />
    );
}

const ticketHref = (t: SlSearchTicket) =>
    t.kind === "repair" ? `/office/repairing/tickets/${t.id}` : "/office/help";

/**
 * `linksInNewTab` — for the POS: a plain click would take the cashier off the
 * till mid-bill, so every link opens a new tab and the dialog stays up.
 */
export default function SlSearchDialog({ linksInNewTab = false }: { linksInNewTab?: boolean }) {
    const { open, setOpen } = useSlSearchStore();
    // Kept across close / reopen: staff often step away to fetch the bill and
    // come back to the same answer.
    const [query, setQuery] = useState("");
    const [searched, setSearched] = useState("");
    const [result, setResult] = useState<SlSearchResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const q = query.trim();
    const tooShort = q.length < SL_SEARCH_MIN_CHARS;

    const inputRef = useRef<HTMLInputElement>(null);
    // Only the newest search may paint: an older, slower answer arriving after a
    // newer one must not replace it.
    const latest = useRef(0);
    const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const search = useCallback(async (term: string, opts: { select?: boolean } = {}) => {
        if (term.length < SL_SEARCH_MIN_CHARS) return;
        const mine = ++latest.current;
        const key = term.toLowerCase();
        const hit = cache.get(key);
        setError(null);
        setSearched(term);
        if (hit) setResult(hit.result);
        if (hit && Date.now() - hit.at < CACHE_FRESH_MS) {
            setLoading(false);
        } else {
            setLoading(true);
            try {
                const { data } = await axios.get<SlSearchResult>("/api/search-slno", { params: { q: term } });
                cache.set(key, { at: Date.now(), result: data });
                if (mine === latest.current) setResult(data);
            } catch (err) {
                if (mine === latest.current) {
                    setError(extractApiError(err, "SL search failed"));
                    if (!hit) setResult(null);
                }
            } finally {
                if (mine === latest.current) setLoading(false);
            }
        }
        if (opts.select && mine === latest.current) inputRef.current?.select();
    }, []);

    // Search by itself once typing pauses. Deliberately NOT selecting the text
    // afterwards: someone reading a long SL no off a unit pauses mid-number, and
    // a selected box would make their next key wipe what they had typed.
    useEffect(() => {
        if (!open || q.length < SL_SEARCH_MIN_CHARS) return;
        autoTimer.current = setTimeout(() => { void search(q); }, AUTO_SEARCH_MS);
        return () => clearTimeout(autoTimer.current);
    }, [open, q, search]);

    /** Enter (a scanner's last key) or the button: search now, then select the SL
     *  no so the next scan replaces it. */
    function runSearch(e?: FormEvent) {
        e?.preventDefault();
        clearTimeout(autoTimer.current);
        void search(q, { select: true });
    }

    // Right-click on any link below → "Open in new window", the same menu the
    // sidebar and Quick Actions bar show (the desktop app has no browser menu).
    const { menu, close: closeMenu, onContainerContextMenu } = useLinkContextMenu();
    const onOpenChange = (next: boolean) => {
        if (!next) closeMenu();
        setOpen(next);
    };
    const close = () => onOpenChange(false);
    /** Spread onto every result link. */
    const nav = { onNavigate: close, newTab: linksInNewTab };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl gap-0 p-0 sm:max-w-3xl">
                <DialogHeader className="border-b border-border px-6 py-5 pr-12">
                    <DialogTitle className="flex items-center gap-2">
                        <ScanSearch size={18} />
                        SL Search
                    </DialogTitle>
                    <DialogDescription>
                        No bill, no name, no phone? Type or scan the SL no on the unit — we look through every bill&apos;s line notes and every repair / help ticket.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={runSearch} className="flex gap-2 border-b border-border px-6 py-4">
                    <div className="relative flex-1">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            // Reopening the dialog (or tabbing back) lands on the last SL
                            // no already selected — a fresh scan simply replaces it.
                            onFocus={(e) => e.currentTarget.select()}
                            placeholder="Type or scan SL no…"
                            className="pl-8 font-mono"
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                    <Button type="submit" disabled={tooShort} className="gap-1.5">
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                        Search
                    </Button>
                </form>

                <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-4" onContextMenu={onContainerContextMenu}>
                    {q.length > 0 && tooShort && !result && (
                        <p className="text-xs text-muted-foreground">Enter at least {SL_SEARCH_MIN_CHARS} characters of the SL no.</p>
                    )}

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {/* Both groups show after every search — an empty Tickets group
                        still tells staff the tickets were checked, not skipped. */}
                    {result && (
                        <section>
                            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <ReceiptText size={13} /> Bills <Badge variant="outline">{result.bills.length}</Badge>
                            </h3>
                            {result.bills.length === 0 ? (
                                <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                                    No bill carries &ldquo;{searched}&rdquo;. A bill has an SL no only when it was typed in the line note at billing.
                                </p>
                            ) : (
                                <div className="divide-y divide-border rounded-md border border-border">
                                    {result.bills.map((b) => {
                                        const href = b.detailId != null ? editFormUrl(b.type, b.detailId) : null;
                                        const partyHref = partyProfileHref(b.partyKind, b.partyEntityId);
                                        return (
                                            <div key={b.lineId} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                                                <div className="min-w-0 flex-1 space-y-0.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge variant="secondary">{voucherTypeLabel(b.type)}</Badge>
                                                        {href ? (
                                                            <RowLink href={href} {...nav} className="font-medium text-primary hover:underline">
                                                                {b.voucherNo ?? "—"}
                                                            </RowLink>
                                                        ) : (
                                                            <span className="font-medium">{b.voucherNo ?? "—"}</span>
                                                        )}
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatDate(parseIsoDateOnly(b.date))} · {sinceLabel(b.date)}
                                                        </span>
                                                    </div>
                                                    <p className="truncate">
                                                        {partyHref ? (
                                                            <RowLink href={partyHref} {...nav} className="text-primary hover:underline">
                                                                {b.partyName ?? "Open party"}
                                                            </RowLink>
                                                        ) : (
                                                            b.partyName ?? "No party on bill"
                                                        )}
                                                        {b.partyPhone && <span className="text-muted-foreground"> · {b.partyPhone}</span>}
                                                    </p>
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {b.productName} × {b.quantity} · <span className="font-mono"><Highlight text={b.note} term={searched} /></span>
                                                    </p>
                                                </div>
                                                {href && (
                                                    <Button asChild size="sm" variant="outline" className="shrink-0">
                                                        <RowLink href={href} {...nav} className="">Open</RowLink>
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {result && (
                        <section>
                            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <Wrench size={13} /> Tickets <Badge variant="outline">{result.tickets.length}</Badge>
                            </h3>
                            {result.tickets.length === 0 ? (
                                <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                                    No repair or help ticket mentions &ldquo;{searched}&rdquo;. A ticket carries an SL no only when staff wrote it in the ticket.
                                </p>
                            ) : (
                                <div className="divide-y divide-border rounded-md border border-border">
                                    {result.tickets.map((t) => {
                                        const partyHref = partyProfileHref(t.partyKind, t.partyEntityId);
                                        return (
                                            <div key={t.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                                                <div className="min-w-0 flex-1 space-y-0.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <RowLink href={ticketHref(t)} {...nav} className="font-medium text-primary hover:underline">
                                                            #{t.id}
                                                        </RowLink>
                                                        <Badge className={t.status.color}>{t.status.label}</Badge>
                                                        <span className="text-xs text-muted-foreground">
                                                            {t.kind === "repair" ? "Repair" : "Help desk"} · {formatDate(t.createdAt)}
                                                        </span>
                                                    </div>
                                                    <p className="truncate">
                                                        {partyHref ? (
                                                            <RowLink href={partyHref} {...nav} className="text-primary hover:underline">
                                                                {t.customerName ?? "Open customer"}
                                                            </RowLink>
                                                        ) : (
                                                            t.customerName ?? "Unknown customer"
                                                        )}
                                                        {t.customerPhone && <span className="text-muted-foreground"> · {t.customerPhone}</span>}
                                                        {t.device && <span className="text-muted-foreground"> · {t.device}</span>}
                                                    </p>
                                                    {t.matchedField && t.matchedText && (
                                                        <p className="truncate text-xs text-muted-foreground">
                                                            {t.matchedField}: <Highlight text={t.matchedText} term={searched} />
                                                        </p>
                                                    )}
                                                </div>
                                                <Button asChild size="sm" variant="outline" className="shrink-0">
                                                    <RowLink href={ticketHref(t)} {...nav} className="">Open</RowLink>
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}
                </div>

                {/* Inside the dialog, not beside it: anything outside the content
                    counts as "click outside", which would close the dialog first. */}
                <LinkContextMenu menu={menu} onClose={closeMenu} />
            </DialogContent>
        </Dialog>
    );
}
