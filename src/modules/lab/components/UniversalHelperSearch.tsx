"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { formatInr } from "@/shared/lib/format";
import {
    Search,
    X,
    Wrench,
    User,
    Building2,
    Package,
    ArrowRight,
    Sparkles,
    Target,
    NotebookPen,
    Trash2,
    Check,
} from "lucide-react";

import { usePartySearch, type PartyHit } from "@/shared/hooks/usePartySearch";
import CustomerContextPanel from "@/modules/lab/components/CustomerContextPanel";
import QuickTicketDialog from "@/modules/lab/components/QuickTicketDialog";
import RegisterCustomerDialog from "@/modules/lab/components/RegisterCustomerDialog";
import CandidateRow from "@/modules/lab/components/CandidateRow";
import QuickActionBar from "@/modules/lab/components/QuickActionBar";
import {
    buildCandidates,
    toQueryTerms,
    type CustomerCandidate,
} from "@/modules/lab/lib/buildCandidates";
import { UserPlus } from "lucide-react";
import { type PickedParty } from "@/shared/components/PartySearchAndCreate";

// ── Types ──────────────────────────────────────────────────────────────────

interface Product {
    id: number;
    sku: string | null;
    name: string;
    stock: number;
    pricePaise: number | null;
    brand: { name: string } | null;
}

interface TicketSearchRow {
    id: string;
    ticketStatus?: { label: string; color: string | null } | null;
    device?: {
        type: string | null;
        brand: string | null;
        model: string | null;
        /**
         * Problem description from ticket creation. Already returned by
         * /api/tickets because Prisma `include` on Device returns all
         * scalar fields. Used by buildCandidates() to score keywords like
         * "battery" against repair history.
         */
        problem: string | null;
        account?: {
            id: number;
            name: string | null;
            phone?: string | null;
        } | null;
    } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Bare numbers starting with 6-9 are Indian mobile prefixes — treat as phone
// search, not ticket IDs. Ticket IDs need the TKT prefix OR must be a short
// number starting with 1-5 (e.g. 1042, 230).
const TICKET_RE = /^(?:tkt[- ]?(\d{1,8})|([1-5]\d{0,5}))$/i;
const PHONE_RE  = /^[6-9]\d{9}$/;

function detectTicketId(q: string): string | null {
    const m = TICKET_RE.exec(q.trim());
    return m ? `TKT-${m[1] ?? m[2]}` : null;
}
function isPhone(q: string): boolean {
    return PHONE_RE.test(q.trim().replace(/\D/g, ""));
}
function formatPaise(p: number | null): string {
    if (p == null) return "—";
    return formatInr(p / 100, 0);
}
function partyHitToPicked(p: PartyHit): PickedParty {
    return {
        kind: p.type === "company" ? "company" : "customer",
        id: p.id,
        name: p.name,
        phone: p.phone,
        accountId: p.accountId,
    };
}

/**
 * Adapter — CustomerContextPanel still expects PartyHit. For ticket-only
 * candidates (no /api/person hit), personId is null → use id: 0 which the
 * panel's people-detail fetch handles gracefully (404 → just shows the
 * name/phone strip from props).
 */
function candidateToPartyHit(c: CustomerCandidate): PartyHit {
    return {
        id: c.personId ?? 0,
        name: c.name,
        phone: c.phone,
        type: c.type,
        accountId: c.accountId,
    };
}

/** Reverse adapter — used when RegisterCustomerDialog bubbles a freshly-created PartyHit. */
function partyHitToCandidate(p: PartyHit): CustomerCandidate {
    return {
        personId: p.id,
        accountId: p.accountId,
        name: p.name,
        phone: p.phone,
        email: p.email ?? null,
        address: p.address ?? null,
        type: p.type,
        evidence: [{ kind: "name", matchedTerm: p.name.toLowerCase() }],
        matchScore: 1,
        termsCovered: new Set([p.name.toLowerCase()]),
    };
}

// ── Shared row / section primitives ───────────────────────────────────────

const ROW_BASE =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted/60 cursor-pointer";

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {children}
        </p>
    );
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Universal helper search — persistent Google-style list, not a dropdown.
 *
 * Three parallel result streams:
 *   1. Customer name / phone  (debounced /api/person?lookup=)
 *   2. Device & repairs        (client-side filter on /api/tickets loaded once)
 *   3. Products                (client-side filter on /api/inventory/products/lookup)
 *
 * Ticket-ID pattern (`TKT-XXXX` or bare number) gets a dedicated "Open ticket" row.
 *
 * Picking a customer opens the CustomerContextPanel beside the results (side-by-side
 * on lg+, stacked on mobile). Staff can immediately switch to a different result
 * without losing context.
 *
 * Keyboard: `/` focuses the input; `Esc` clears everything.
 */
export default function UniversalHelperSearch() {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");

    // ── Data: customers (debounced) ───────────────────────────────────────
    // `wide` so a query like "rosy delhi" can pair a name token (rosy) with an
    // address token (delhi) — see buildCandidates for the per-term scoring.
    const { hits: peopleHits, loading: peopleLoading } = usePartySearch(query, { wide: true });

    // ── Data: products (load once, filter in memory) ──────────────────────
    const [products, setProducts]         = useState<Product[]>([]);
    const [productsLoaded, setProductsLoaded] = useState(false);

    // ── Data: tickets (load once, filter in memory by device brand/model) ─
    const [tickets, setTickets]           = useState<TicketSearchRow[]>([]);
    const [ticketsLoaded, setTicketsLoaded]   = useState(false);

    useEffect(() => {
        let c1 = false, c2 = false;

        axios.get<Product[]>("/api/inventory/products/lookup")
            .then(r => { if (!c1) { setProducts(r.data); setProductsLoaded(true); } })
            .catch(() => { if (!c1) setProductsLoaded(true); });

        axios.get<TicketSearchRow[]>("/api/tickets")
            .then(r => { if (!c2) { setTickets(r.data); setTicketsLoaded(true); } })
            .catch(() => { if (!c2) setTicketsLoaded(true); });

        return () => { c1 = true; c2 = true; };
    }, []);

    // ── Derived ───────────────────────────────────────────────────────────
    const q          = query.trim().toLowerCase();
    const hasQuery   = q.length >= 2;
    const ticketId   = detectTicketId(query);
    const phoneish   = isPhone(query);
    const queryTerms = useMemo(() => toQueryTerms(query), [query]);

    const productMatches = useMemo(() => {
        if (!hasQuery) return [];
        return products
            .filter(p =>
                `${p.name} ${p.sku ?? ""} ${p.brand?.name ?? ""}`.toLowerCase().includes(q)
            )
            .slice(0, 6);
    }, [q, products, hasQuery]);

    /**
     * Unified customer candidates — merges /api/person hits with ticket-derived
     * customer info, scoring by how many distinct query terms have evidence
     * across name/phone/device/problem. See `buildCandidates` for the algorithm.
     * Don't run when the query is a ticket ID — the dedicated "Open ticket" row
     * handles that case.
     */
    const candidates = useMemo(() => {
        if (!hasQuery || ticketId || queryTerms.length === 0) return [];
        return buildCandidates(peopleHits, tickets, queryTerms);
    }, [peopleHits, tickets, queryTerms, hasQuery, ticketId]);

    // ── Customer context panel ────────────────────────────────────────────
    const [pickedCandidate, setPickedCandidate] = useState<CustomerCandidate | null>(null);
    // detailOpen = user clicked the customer in the sidebar → full detail takes left column
    const [detailOpen, setDetailOpen] = useState(false);
    const [ticketOpen, setTicketOpen]   = useState(false);

    // ── Register-new-customer dialog ──────────────────────────────────────
    const [registerOpen, setRegisterOpen] = useState(false);

    const dataReady  = productsLoaded && ticketsLoaded;
    const searching  = hasQuery && (peopleLoading || !dataReady);
    const noResults  = hasQuery && !searching && !ticketId &&
                       candidates.length === 0 &&
                       productMatches.length === 0;

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        function handle(e: KeyboardEvent) {
            if (e.key === "/" && document.activeElement !== inputRef.current) {
                e.preventDefault();
                inputRef.current?.focus();
            }
            if (e.key === "Escape") {
                if (detailOpen) { setDetailOpen(false); return; }
                setQuery("");
                setPickedCandidate(null);
                inputRef.current?.blur();
            }
        }
        document.addEventListener("keydown", handle);
        return () => document.removeEventListener("keydown", handle);
    }, [detailOpen]);

    return (
        <section>
            <div className="grid items-start gap-4 lg:grid-cols-[1fr_300px_auto]">

                {/* ── LEFT: search + results (always) ── */}
                <div className="space-y-3">
                    <div className="relative flex items-center rounded-xl border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-primary/25 transition-shadow">
                        <Search
                            size={18}
                            className="absolute left-4 shrink-0 text-muted-foreground pointer-events-none"
                        />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => {
                                setQuery(e.target.value);
                                if (!e.target.value.trim()) { setPickedCandidate(null); setDetailOpen(false); }
                                else if (detailOpen) setDetailOpen(false);
                            }}
                            placeholder='Try clues: "mac battery", "asus rajan", phone, or TKT-1042'
                            className="w-full bg-transparent py-3.5 pl-11 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none"
                        />
                        {query ? (
                            <button
                                onClick={() => {
                                    setQuery("");
                                    setPickedCandidate(null);
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-3 rounded p-1 text-muted-foreground hover:text-foreground"
                                title="Clear"
                            >
                                <X size={15} />
                            </button>
                        ) : (
                            <kbd className="absolute right-3 hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">
                                /
                            </kbd>
                        )}
                    </div>

                    {/* When detailOpen: full-width customer detail replaces the results */}
                    {detailOpen && pickedCandidate ? (
                        <CustomerContextPanel
                            party={candidateToPartyHit(pickedCandidate)}
                            onClose={() => setDetailOpen(false)}
                            onNewTicket={() => setTicketOpen(true)}
                        />
                    ) : (
                        <>
                            {!hasQuery && <EmptyHint />}

                            {hasQuery && (
                                <div className="space-y-4 rounded-xl border border-border bg-card p-3">
                                    {ticketId && (
                                        <div>
                                            <SectionHeading>Open ticket</SectionHeading>
                                            <button
                                                className={ROW_BASE}
                                                onClick={() =>
                                                    router.push(`/office/repairing/tickets/${ticketId}`)
                                                }
                                            >
                                                <Wrench size={15} className="shrink-0 text-orange-600" />
                                                <span className="font-mono font-medium">{ticketId}</span>
                                                <span className="text-xs text-muted-foreground">Open ticket page</span>
                                                <ArrowRight size={13} className="ml-auto opacity-50" />
                                            </button>
                                        </div>
                                    )}

                                    {candidates.length > 0 && (
                                        <div>
                                            <CandidatesConfidenceHeader count={candidates.length} phoneish={phoneish} />
                                            <div className="mt-1.5 space-y-0.5">
                                                {candidates.slice(0, 12).map(c => {
                                                    const key = c.accountId != null
                                                        ? `account-${c.accountId}`
                                                        : `person-${c.type}-${c.personId ?? "anon"}`;
                                                    const active = pickedCandidate
                                                        ? (c.accountId != null
                                                            ? pickedCandidate.accountId === c.accountId
                                                            : pickedCandidate.personId === c.personId
                                                              && pickedCandidate.type === c.type)
                                                        : false;
                                                    return (
                                                        <CandidateRow
                                                            key={key}
                                                            candidate={c}
                                                            isActive={active}
                                                            onSelect={c => { setPickedCandidate(c); setDetailOpen(false); }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {productMatches.length > 0 && (
                                        <div>
                                            <SectionHeading>Products ({productMatches.length})</SectionHeading>
                                            <div className="space-y-0.5">
                                                {productMatches.map(prod => (
                                                    <button
                                                        key={`product-${prod.id}`}
                                                        className={ROW_BASE}
                                                        onClick={() => router.push("/office/inventory/products")}
                                                    >
                                                        <Package size={15} className="shrink-0 text-emerald-600" />
                                                        <div className="flex min-w-0 flex-1 flex-col">
                                                            <span className="truncate font-medium">{prod.name}</span>
                                                            <span className="truncate text-xs text-muted-foreground">
                                                                {prod.brand?.name ? `${prod.brand.name} · ` : ""}
                                                                {prod.sku ?? "no SKU"}
                                                            </span>
                                                        </div>
                                                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                                                            <span className="font-medium">{formatPaise(prod.pricePaise)}</span>
                                                            <span className={prod.stock <= 0 ? "text-[10px] text-destructive" : "text-[10px] text-muted-foreground"}>
                                                                Stock: {prod.stock}
                                                            </span>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {searching && !ticketId && candidates.length === 0 && productMatches.length === 0 && (
                                        <p className="py-4 text-center text-xs text-muted-foreground">Searching…</p>
                                    )}
                                    {noResults && (
                                        <div className="flex flex-col items-center gap-3 py-5">
                                            <p className="text-center text-xs text-muted-foreground">
                                                No results for &ldquo;{query}&rdquo;.{" "}
                                                Try a name, phone number, device brand, or ticket ID.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setRegisterOpen(true)}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-blue-500/40 bg-blue-500/5 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/10 dark:text-blue-400"
                                            >
                                                <UserPlus size={13} />
                                                Register new customer
                                            </button>
                                        </div>
                                    )}
                                    {hasQuery && candidates.length > 0 && !searching && (
                                        <div className="border-t border-dashed border-border pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setRegisterOpen(true)}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                            >
                                                <UserPlus size={11} />
                                                Not the right person? Register new customer
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── RIGHT: sidebar preview (when picked) + always-visible QuickNote ── */}
                <div className="hidden lg:flex flex-col gap-4">
                    {pickedCandidate && !detailOpen && (
                        <div className="max-h-[55vh] overflow-y-auto rounded-xl">
                            <CustomerContextPanel
                                party={candidateToPartyHit(pickedCandidate)}
                                onClose={() => { setPickedCandidate(null); setDetailOpen(false); }}
                                onNewTicket={() => setTicketOpen(true)}
                                onViewFullProfile={() => setDetailOpen(true)}
                            />
                        </div>
                    )}
                    <QuickNoteBox />
                </div>

                {/* ── FAR RIGHT: slim quick-action toolbar (extra, after customer panel) ── */}
                <QuickActionBar onNewTicket={() => setTicketOpen(true)} />
            </div>

            <QuickTicketDialog
                open={ticketOpen}
                onOpenChange={setTicketOpen}
                initialParty={
                    pickedCandidate
                        ? partyHitToPicked(candidateToPartyHit(pickedCandidate))
                        : null
                }
            />

            <RegisterCustomerDialog
                open={registerOpen}
                onOpenChange={setRegisterOpen}
                initialQuery={query.trim()}
                onRegistered={(party) => {
                    setPickedCandidate(partyHitToCandidate(party));
                }}
            />
        </section>
    );
}

// ── Candidates header — confidence cue above the candidate list ───────────

function CandidatesConfidenceHeader({
    count,
    phoneish,
}: {
    count: number;
    phoneish: boolean;
}) {
    // Single candidate — the happy "you got them" state.
    if (count === 1) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <Target size={13} />
                Likely match — confirm identity below
            </div>
        );
    }

    // Two candidates — almost there.
    if (count === 2) {
        return (
            <p className="px-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Almost there — 2 candidates, one more clue should do it
            </p>
        );
    }

    // 3–9 candidates — narrowing.
    if (count < 10) {
        return (
            <p className="px-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Narrowing… {count} candidates
            </p>
        );
    }

    // 10+ candidates — keep typing.
    return (
        <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {phoneish ? "Customers · phone match" : "Customers"} ({count}) — type
            another clue to narrow
        </p>
    );
}

// ── Quick Note Box ────────────────────────────────────────────────────────

interface SavedNote {
    id: number;
    text: string;
    createdAt: string;
}

function QuickNoteBox() {
    const [draft, setDraft] = useState("");
    const [notes, setNotes] = useState<SavedNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Load notes from DB on mount
    useEffect(() => {
        axios.get<SavedNote[]>("/api/quick-notes")
            .then(r => setNotes(r.data))
            .catch(() => { /* silently fail — user sees empty list */ })
            .finally(() => setLoading(false));
    }, []);

    async function save() {
        const text = draft.trim();
        if (!text || saving) return;
        setSaving(true);
        try {
            const { data } = await axios.post<SavedNote>("/api/quick-notes", { text });
            setNotes(prev => [data, ...prev]);
            setDraft("");
        } finally {
            setSaving(false);
        }
    }

    async function deleteNote(id: number) {
        // Optimistic removal
        setNotes(prev => prev.filter(n => n.id !== id));
        try {
            await axios.delete(`/api/quick-notes/${id}`);
        } catch {
            // Reload on failure to restore state
            axios.get<SavedNote[]>("/api/quick-notes").then(r => setNotes(r.data)).catch(() => {});
        }
    }

    return (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <NotebookPen size={13} className="shrink-0 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quick Note
                    </span>
                </div>
                {notes.length > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {notes.length}
                    </span>
                )}
            </div>

            {/* Resizable textarea */}
            <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
                placeholder="Jot something down… (Ctrl+Enter to save)"
                rows={4}
                className="w-full resize-y rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 transition-shadow min-h-[80px] max-h-[360px]"
            />

            {/* Save action */}
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={save}
                    disabled={!draft.trim() || saving}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                    <Check size={11} />
                    {saving ? "Saving…" : "Save Note"}
                </button>
            </div>

            {/* Saved notes list */}
            {(loading || notes.length > 0) && (
                <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {loading ? "Loading…" : `Saved (${notes.length})`}
                    </p>
                    {!loading && (
                        <div className="max-h-[340px] space-y-2 overflow-y-auto pr-0.5">
                            {notes.map(note => (
                                <div
                                    key={note.id}
                                    className="group relative rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                                >
                                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground pr-5">
                                        {note.text}
                                    </p>
                                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                                        {new Date(note.createdAt).toLocaleString("en-IN", {
                                            day: "numeric", month: "short",
                                            hour: "2-digit", minute: "2-digit",
                                        })}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => deleteNote(note.id)}
                                        title="Delete"
                                        className="absolute right-2 top-2.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Idle hint ──────────────────────────────────────────────────────────────

function EmptyHint() {
    const examples = [
        {
            icon: Wrench,
            label: "TKT-1042",
            desc: "jump straight to a ticket",
        },
        {
            icon: User,
            label: "9876543210",
            desc: "find customer by phone",
        },
        {
            icon: Package,
            label: "asus laptop",
            desc: "search product or repair device",
        },
        {
            icon: Building2,
            label: "rajan sharma",
            desc: "open customer KYC & history",
        },
    ];

    return (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Sparkles size={12} />
                What can I help you with?
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {examples.map(ex => {
                    const Icon = ex.icon;
                    return (
                        <div key={ex.label} className="flex items-center gap-3">
                            <Icon size={13} className="shrink-0 text-muted-foreground" />
                            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                                {ex.label}
                            </code>
                            <span className="text-xs text-muted-foreground">{ex.desc}</span>
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">/</kbd>{" "}
                to focus · <kbd className="rounded border border-border bg-muted px-1 font-mono">Esc</kbd>{" "}
                to clear
            </div>
        </div>
    );
}
