"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
    Search,
    X,
    Wrench,
    User,
    Building2,
    Package,
    ArrowRight,
    Sparkles,
    CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/lib/format/utils";
import { usePartySearch, type PartyHit } from "@/shared/hooks/usePartySearch";
import CustomerContextPanel from "@/modules/lab/components/CustomerContextPanel";
import QuickTicketDialog from "@/modules/lab/components/QuickTicketDialog";
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
        account?: {
            id: number;
            name: string | null;
            phone?: string | null;
        } | null;
    } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TICKET_RE = /^(?:tkt[- ]?)?(\d{1,8})$/i;
const PHONE_RE  = /^[6-9]\d{9}$/;

function detectTicketId(q: string): string | null {
    const m = TICKET_RE.exec(q.trim());
    return m ? `TKT-${m[1]}` : null;
}
function isPhone(q: string): boolean {
    return PHONE_RE.test(q.trim().replace(/\D/g, ""));
}
function formatPaise(p: number | null): string {
    if (p == null) return "—";
    return `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function partyHitToPicked(p: PartyHit): PickedParty {
    return {
        kind: p.type === "company" ? "company" : "person",
        id: p.id,
        name: p.name,
        phone: p.phone,
        accountId: p.accountId,
    };
}

// ── Shared row / section primitives ───────────────────────────────────────

const ROW_BASE =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted/60 cursor-pointer";
const ROW_ACTIVE = "bg-primary/5 ring-1 ring-inset ring-primary/20 hover:bg-primary/5";

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
 *   1. Customer name / phone  (debounced /api/people?lookup=)
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
    const { hits: peopleHits, loading: peopleLoading } = usePartySearch(query);

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
    const q        = query.trim().toLowerCase();
    const hasQuery = q.length >= 2;
    const ticketId = detectTicketId(query);
    const phoneish = isPhone(query);

    const productMatches = useMemo(() => {
        if (!hasQuery) return [];
        return products
            .filter(p =>
                `${p.name} ${p.sku ?? ""} ${p.brand?.name ?? ""}`.toLowerCase().includes(q)
            )
            .slice(0, 6);
    }, [q, products, hasQuery]);

    const ticketMatches = useMemo(() => {
        // Don't show device results when the query is already a ticket ID
        if (!hasQuery || ticketId) return [];
        return tickets
            .filter(t => {
                const hay = [
                    t.device?.brand,
                    t.device?.model,
                    t.device?.type,
                    t.device?.account?.name,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return hay.includes(q);
            })
            .slice(0, 6);
    }, [q, tickets, hasQuery, ticketId]);

    // ── Customer context panel ────────────────────────────────────────────
    const [pickedParty, setPickedParty] = useState<PartyHit | null>(null);
    const [ticketOpen, setTicketOpen]   = useState(false);

    const dataReady  = productsLoaded && ticketsLoaded;
    const searching  = hasQuery && (peopleLoading || !dataReady);
    const noResults  = hasQuery && !searching && !ticketId &&
                       peopleHits.length === 0 &&
                       ticketMatches.length === 0 &&
                       productMatches.length === 0;

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        function handle(e: KeyboardEvent) {
            if (e.key === "/" && document.activeElement !== inputRef.current) {
                e.preventDefault();
                inputRef.current?.focus();
            }
            if (e.key === "Escape") {
                setQuery("");
                setPickedParty(null);
                inputRef.current?.blur();
            }
        }
        document.addEventListener("keydown", handle);
        return () => document.removeEventListener("keydown", handle);
    }, []);

    return (
        <section className="space-y-3">

            {/* ── Hero search input ── */}
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
                        if (!e.target.value.trim()) setPickedParty(null);
                    }}
                    placeholder='Search by name, phone, brand, model — e.g. "asus", "9876543210", "TKT-1042"'
                    className="w-full bg-transparent py-3.5 pl-11 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none"
                />
                {query ? (
                    <button
                        onClick={() => {
                            setQuery("");
                            setPickedParty(null);
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

            {/* ── Empty / idle hint ── */}
            {!hasQuery && <EmptyHint />}

            {/* ── Results + context panel ── */}
            {hasQuery && (
                <div
                    className={cn(
                        "grid items-start gap-4",
                        pickedParty
                            ? "lg:grid-cols-[380px_1fr]"
                            : "grid-cols-1"
                    )}
                >
                    {/* ── LEFT: Results list ── */}
                    <div className="space-y-4 rounded-xl border border-border bg-card p-3">

                        {/* Direct ticket open */}
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
                                    <span className="text-xs text-muted-foreground">
                                        Open ticket page
                                    </span>
                                    <ArrowRight size={13} className="ml-auto opacity-50" />
                                </button>
                            </div>
                        )}

                        {/* Customer matches */}
                        {peopleHits.length > 0 && (
                            <div>
                                <SectionHeading>
                                    {phoneish ? "Customers · phone match" : "Customers"}{" "}
                                    ({peopleHits.length})
                                </SectionHeading>
                                <div className="space-y-0.5">
                                    {peopleHits.slice(0, 8).map(p => {
                                        const active =
                                            pickedParty?.id === p.id &&
                                            pickedParty?.type === p.type;
                                        return (
                                            <button
                                                key={`person-${p.type}-${p.id}`}
                                                className={cn(ROW_BASE, active && ROW_ACTIVE)}
                                                onClick={() => setPickedParty(p)}
                                            >
                                                {p.type === "company" ? (
                                                    <Building2
                                                        size={15}
                                                        className="shrink-0 text-purple-600"
                                                    />
                                                ) : (
                                                    <User
                                                        size={15}
                                                        className="shrink-0 text-blue-600"
                                                    />
                                                )}
                                                <span className="flex-1 truncate font-medium">
                                                    {p.name}
                                                </span>
                                                {p.phone && (
                                                    <span className="shrink-0 text-xs text-muted-foreground">
                                                        {p.phone}
                                                    </span>
                                                )}
                                                <Badge
                                                    variant="secondary"
                                                    className="shrink-0 text-[10px]"
                                                >
                                                    {p.type === "company" ? "Company" : "Person"}
                                                </Badge>
                                                {active && (
                                                    <CheckCircle2
                                                        size={14}
                                                        className="shrink-0 text-primary"
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Device & repair ticket matches */}
                        {ticketMatches.length > 0 && (
                            <div>
                                <SectionHeading>
                                    Devices & repairs ({ticketMatches.length})
                                </SectionHeading>
                                <div className="space-y-0.5">
                                    {ticketMatches.map(t => (
                                        <button
                                            key={`ticket-${t.id}`}
                                            className={ROW_BASE}
                                            onClick={() =>
                                                router.push(
                                                    `/office/repairing/tickets/${t.id}`
                                                )
                                            }
                                        >
                                            <Wrench
                                                size={15}
                                                className="shrink-0 text-orange-600"
                                            />
                                            <span className="shrink-0 font-mono text-xs font-medium">
                                                {t.id}
                                            </span>
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate text-sm font-medium">
                                                    {[t.device?.brand, t.device?.model]
                                                        .filter(Boolean)
                                                        .join(" ")}
                                                </span>
                                                {t.device?.account?.name && (
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {t.device.account.name}
                                                    </span>
                                                )}
                                            </div>
                                            {t.ticketStatus && (
                                                <span
                                                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                                    style={{
                                                        backgroundColor: t.ticketStatus.color
                                                            ? `${t.ticketStatus.color}20`
                                                            : undefined,
                                                        color: t.ticketStatus.color ?? undefined,
                                                    }}
                                                >
                                                    {t.ticketStatus.label}
                                                </span>
                                            )}
                                            <ArrowRight
                                                size={13}
                                                className="ml-auto shrink-0 opacity-40"
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Product matches */}
                        {productMatches.length > 0 && (
                            <div>
                                <SectionHeading>
                                    Products ({productMatches.length})
                                </SectionHeading>
                                <div className="space-y-0.5">
                                    {productMatches.map(prod => (
                                        <button
                                            key={`product-${prod.id}`}
                                            className={ROW_BASE}
                                            onClick={() =>
                                                router.push("/office/inventory/products")
                                            }
                                        >
                                            <Package
                                                size={15}
                                                className="shrink-0 text-emerald-600"
                                            />
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate font-medium">
                                                    {prod.name}
                                                </span>
                                                <span className="truncate text-xs text-muted-foreground">
                                                    {prod.brand?.name
                                                        ? `${prod.brand.name} · `
                                                        : ""}
                                                    {prod.sku ?? "no SKU"}
                                                </span>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                                                <span className="font-medium">
                                                    {formatPaise(prod.pricePaise)}
                                                </span>
                                                <span
                                                    className={
                                                        prod.stock <= 0
                                                            ? "text-[10px] text-destructive"
                                                            : "text-[10px] text-muted-foreground"
                                                    }
                                                >
                                                    Stock: {prod.stock}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* States */}
                        {searching && !ticketId && peopleHits.length === 0 &&
                            ticketMatches.length === 0 && productMatches.length === 0 && (
                            <p className="py-4 text-center text-xs text-muted-foreground">
                                Searching…
                            </p>
                        )}
                        {noResults && (
                            <p className="py-4 text-center text-xs text-muted-foreground">
                                No results for &ldquo;{query}&rdquo;.{" "}
                                Try a name, phone number, device brand, or ticket ID.
                            </p>
                        )}
                    </div>

                    {/* ── RIGHT: Customer context panel ── */}
                    {pickedParty && (
                        <CustomerContextPanel
                            party={pickedParty}
                            onClose={() => setPickedParty(null)}
                            onNewTicket={() => setTicketOpen(true)}
                        />
                    )}
                </div>
            )}

            {/* Pre-filled ticket dialog */}
            <QuickTicketDialog
                open={ticketOpen}
                onOpenChange={setTicketOpen}
                initialParty={pickedParty ? partyHitToPicked(pickedParty) : null}
            />
        </section>
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
