"use client";

/**
 * UniversalCustomerPanel
 *
 * Shown at the top of /office for EVERY authenticated staff member.
 * Implements the owner's rule: whoever picks up a call/WhatsApp/walk-in
 * must be able to give a quick answer AND log the request — regardless
 * of their department or position.
 *
 * Three sections:
 *  1. Product quick-lookup (price + stock) — no permission gate
 *  2. Repair ticket status — search by customer name, phone, or ticket # — no permission gate
 *  3. Three log buttons → P6 (CRM/sales), P2 (helpdesk), P4 (internal)
 *     Sales Query also lets staff identify the customer from the system
 *     (personId link) so CRM sees full history.
 */

import { GatedLink } from "@/shared/components/GatedLink";
import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { useProductCatalog, loadProductCatalog } from "@/shared/hooks";
import { scoreProductSearch } from "@/shared/lib/inventory";
import {
    Search, ShoppingBag, Wrench, PhoneCall, HeadphonesIcon, ClipboardList,
    X, Package, User, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { usePartySearch, type PartyHit } from "@/shared/hooks/usePartySearch";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductOption {
    id: number;
    sku: string;
    name: string;
    stock: number | null;
    pricePaise: number | null;
    mrpPaise: number | null;
    unit: { code: string };
    brand: { name: string } | null;
    attrsJson?: unknown;
    codes?: readonly { value: string }[] | null;
}

interface TicketLookupResult {
    id: number;
    status: string;
    customerName: string;
    ticketStatus: { label: string; color: string | null };
    device: { brand: string; model: string };
    primaryOwner: { name: string } | null;
    expectedReturn: string | null;
}

type LogType = "sales" | "helpdesk" | "internal";

interface LogConfig {
    pipelineId: "P6" | "P2" | "P4";
    title: string;
    icon: React.ReactNode;
    color: string;
    placeholder: string;
    showCustomer: boolean;
    showChannel: boolean;
}

const LOG_CONFIGS: Record<LogType, LogConfig> = {
    sales: {
        pipelineId: "P6",
        title: "Log Sales Query",
        icon: <PhoneCall size={16} />,
        color: "bg-green-50 text-green-700 border-green-200",
        placeholder: "e.g. Asking price of 4MP CCTV camera, wants 6 units",
        showCustomer: true,
        showChannel: true,
    },
    helpdesk: {
        pipelineId: "P2",
        title: "Log Customer Problem",
        icon: <HeadphonesIcon size={16} />,
        color: "bg-teal-50 text-teal-700 border-teal-200",
        placeholder: "e.g. DVR not recording, system showing offline since morning",
        showCustomer: true,
        showChannel: true,
    },
    internal: {
        pipelineId: "P4",
        title: "Log Internal Request",
        icon: <ClipboardList size={16} />,
        color: "bg-purple-50 text-purple-700 border-purple-200",
        placeholder: "e.g. Pay electricity bill for this month, Order CAT6 cable from vendor",
        showCustomer: false,
        showChannel: false,
    },
};

const CHANNELS = ["Phone", "WhatsApp", "Walk-in", "Email", "Other"] as const;

function paiseToRs(paise: number | null): string {
    if (paise == null) return "—";
    return `₹${(paise / 100).toFixed(0)}`;
}

// ── Product Quick Lookup ───────────────────────────────────────────────────────

function ProductLookup() {
    const [query, setQuery] = useState("");
    // Shared IndexedDB-backed catalogue — `eager: false` because this panel
    // sits on every staff member's home page but most never open the product
    // lookup, so it stays reactive without costing a fetch until asked.
    const { products } = useProductCatalog<ProductOption>({ eager: false });
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load full catalog once on first focus (same pattern as POS)
    async function ensureLoaded() {
        if (loaded) return;
        setLoading(true);
        try {
            await loadProductCatalog<ProductOption>();
            setLoaded(true);
        } catch {
            toast.error("Could not load product catalog");
        } finally {
            setLoading(false);
        }
    }

    // EXPERIMENTAL: tokenized smart search (order-independent, scores name +
    // sku + brand + attrsJson + codes) — see scoreProductSearch. Only wired
    // in here, not into the shared POS/ecommerce/inventory pickers.
    const q = query.trim();
    const filtered = q.length < 2
        ? []
        : products
            .map((p) => ({ p, score: scoreProductSearch(p, q) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((x) => x.p);

    return (
        <div className="flex-1 min-w-0">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <ShoppingBag size={12} />
                Product — price &amp; stock
            </Label>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                    ref={inputRef}
                    value={query}
                    onFocus={ensureLoaded}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search product by name or SKU…"
                    className="pl-8 h-9 text-sm"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {loading && (
                <p className="text-xs text-muted-foreground mt-2">Loading catalog…</p>
            )}

            {filtered.length > 0 && (
                <div className="mt-2 border border-border rounded-md overflow-hidden bg-card shadow-sm">
                    {filtered.map((p) => (
                        <div
                            key={p.id}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm border-b border-border last:border-0 hover:bg-muted/40"
                        >
                            <Package size={14} className="text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-foreground truncate">{p.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {p.brand?.name ?? "—"} &nbsp;·&nbsp; SKU: {p.sku}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="font-semibold text-foreground text-sm">{paiseToRs(p.pricePaise ?? p.mrpPaise)}</p>
                                <p className={`text-xs font-medium ${(p.stock ?? 0) > 0 ? "text-green-600" : "text-destructive"}`}>
                                    Stock: {p.stock ?? 0} {p.unit.code}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {q.length >= 2 && !loading && filtered.length === 0 && loaded && (
                <p className="text-xs text-muted-foreground mt-2">No product matched &ldquo;{query}&rdquo;</p>
            )}
        </div>
    );
}

// ── Repair Status Lookup ──────────────────────────────────────────────────────
// Accepts customer name, phone number, or ticket # — customer never needs to
// remember the ticket number to get a status update.

function RepairStatusLookup() {
    const [query, setQuery] = useState("");
    const [tickets, setTickets] = useState<TicketLookupResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [expanded, setExpanded] = useState<number | null>(null);

    // Debounced search — fires 450 ms after the user stops typing
    const search = useCallback(async (q: string) => {
        const trimmed = q.trim();
        if (trimmed.length < 2) {
            setTickets([]);
            setSearched(false);
            return;
        }
        setLoading(true);
        setSearched(false);
        try {
            const { data } = await axios.get<TicketLookupResult[]>(
                `/api/tickets/lookup?q=${encodeURIComponent(trimmed)}`
            );
            setTickets(data);
        } catch {
            toast.error("Failed to search tickets");
            setTickets([]);
        } finally {
            setLoading(false);
            setSearched(true);
        }
    }, []);

    // Bumped by the change signal so the search re-runs with the query the user
    // already typed — a ticket raised for this customer at another desk should
    // appear in the results they are looking at.
    const [reloadKey, setReloadKey] = useState(0);
    useRealtimeTopics(["tickets", "parties"], () => { setReloadKey((n) => n + 1); });

    useEffect(() => {
        const id = setTimeout(() => search(query), 450);
        return () => clearTimeout(id);
    }, [query, search, reloadKey]);

    function clear() {
        setQuery("");
        setTickets([]);
        setSearched(false);
        setExpanded(null);
    }

    return (
        <div className="flex-1 min-w-0">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Wrench size={12} />
                Repair status — name, phone or ticket #
            </Label>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setExpanded(null); }}
                    placeholder="e.g. Ramesh, 9876543210 or #1042…"
                    className="pl-8 h-9 text-sm"
                />
                {query && (
                    <button
                        type="button"
                        onClick={clear}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {loading && (
                <p className="text-xs text-muted-foreground mt-2">Searching…</p>
            )}

            {!loading && tickets.length > 0 && (
                <div className="mt-2 border border-border rounded-md overflow-hidden bg-card shadow-sm">
                    {tickets.map((t) => (
                        <div key={t.id} className="border-b border-border last:border-0">
                            {/* Summary row — always visible */}
                            <button
                                type="button"
                                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40 text-left"
                            >
                                <User size={14} className="text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-foreground truncate">{t.customerName}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        #{t.id} &nbsp;·&nbsp; {t.device.brand} {t.device.model}
                                    </p>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${t.ticketStatus.color ?? "bg-muted text-muted-foreground"}`}>
                                    {t.ticketStatus.label}
                                </span>
                                <ChevronRight
                                    size={14}
                                    className={`text-muted-foreground shrink-0 transition-transform ${expanded === t.id ? "rotate-90" : ""}`}
                                />
                            </button>

                            {/* Expanded detail */}
                            {expanded === t.id && (
                                <div className="px-4 pb-3 pt-1 text-sm bg-muted/20 space-y-1 border-t border-border">
                                    <p className="text-muted-foreground">
                                        <span className="font-medium text-foreground">{t.device.brand} {t.device.model}</span>
                                        {t.primaryOwner && (
                                            <span className="ml-2">· Technician: <span className="text-foreground">{t.primaryOwner.name}</span></span>
                                        )}
                                    </p>
                                    {t.expectedReturn && (
                                        <p className="text-xs text-muted-foreground">
                                            Expected return: {new Date(t.expectedReturn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                        </p>
                                    )}
                                    <GatedLink
                                        href={`/office/repairing/tickets/${t.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                                    >
                                        Open ticket →
                                    </GatedLink>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!loading && searched && tickets.length === 0 && query.trim().length >= 2 && (
                <p className="text-xs text-muted-foreground mt-2">
                    No active repair found for &ldquo;{query.trim()}&rdquo;
                </p>
            )}
        </div>
    );
}

// ── Customer Search (used inside Sales Query dialog) ──────────────────────────

interface CustomerPickerProps {
    picked: PartyHit | null;
    onPick: (hit: PartyHit) => void;
    onClear: () => void;
}

function CustomerPicker({ picked, onPick, onClear }: CustomerPickerProps) {
    const [query, setQuery] = useState("");
    const { hits, loading } = usePartySearch(query, {
        enabled: picked == null,
        group: "Sundry Debtors",
    });

    if (picked) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <User size={14} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{picked.name}</p>
                    {picked.phone && (
                        <p className="text-xs text-muted-foreground">{picked.phone}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => { onClear(); setQuery(""); }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Remove customer"
                >
                    <X size={14} />
                </button>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search existing customer by name or phone…"
                    className="pl-8 h-9 text-sm"
                    autoFocus
                />
                {query && (
                    <button type="button" onClick={() => setQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={14} />
                    </button>
                )}
            </div>

            {loading && (
                <p className="text-xs text-muted-foreground mt-1 pl-1">Searching…</p>
            )}

            {!loading && hits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border border-border rounded-md bg-card shadow-md overflow-hidden">
                    {hits.map((h) => (
                        <button
                            key={`${h.type}-${h.id}`}
                            type="button"
                            onClick={() => { onPick(h); setQuery(""); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/50 text-left border-b border-border last:border-0"
                        >
                            <User size={13} className="text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-foreground truncate">{h.name}</p>
                                {h.phone && <p className="text-xs text-muted-foreground">{h.phone}</p>}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {!loading && query.trim().length >= 2 && hits.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1 pl-1">
                    No existing customer found — you can still type their name below.
                </p>
            )}
        </div>
    );
}

// ── Quick Log Dialog ───────────────────────────────────────────────────────────

interface QuickLogDialogProps {
    logType: LogType;
    open: boolean;
    onClose: () => void;
}

function QuickLogDialog({ logType, open, onClose }: QuickLogDialogProps) {
    const cfg = LOG_CONFIGS[logType];
    const isSales = logType === "sales";

    const [pickedParty, setPickedParty] = useState<PartyHit | null>(null);
    const [title, setTitle] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [phone, setPhone] = useState("");
    const [channel, setChannel] = useState<string>(CHANNELS[0]);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            setPickedParty(null);
            setTitle("");
            setCustomerName("");
            setPhone("");
            setChannel(CHANNELS[0]);
            setNotes("");
        }
    }, [open]);

    function handlePickParty(hit: PartyHit) {
        setPickedParty(hit);
        setCustomerName(hit.name);
        if (hit.phone && !phone) setPhone(hit.phone);
    }

    function handleClearParty() {
        setPickedParty(null);
        setCustomerName("");
        setPhone("");
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) {
            toast.error("Please describe the request or query");
            return;
        }
        setSubmitting(true);
        try {
            await axios.post("/api/quick-log", {
                pipelineId: cfg.pipelineId,
                title: title.trim(),
                contactName: customerName.trim() || null,
                phone: phone.trim() || null,
                source: cfg.showChannel ? channel : null,
                notes: notes.trim() || null,
                personId: pickedParty?.type === "customer" ? pickedParty.id : null,
                companyId: pickedParty?.type === "company" ? pickedParty.id : null,
            });
            toast.success("Logged — the right team will follow up");
            onClose();
        } catch {
            toast.error("Failed to log request");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="max-w-md gap-0 p-0">
                <DialogHeader className="border-b border-border px-6 py-5">
                    <DialogTitle className="flex items-center gap-2">
                        {cfg.icon}
                        {cfg.title}
                    </DialogTitle>
                    <DialogDescription>
                        {logType === "internal"
                            ? "Log an internal business request — the admin team will process it."
                            : "Log this query — the right team will follow up."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                    {/* Customer identification — sales queries link to a real customer record */}
                    {isSales && (
                        <div className="space-y-1.5">
                            <Label className="text-xs">
                                Identify customer
                                <span className="text-muted-foreground ml-1">(search existing, or fill below)</span>
                            </Label>
                            <CustomerPicker
                                picked={pickedParty}
                                onPick={handlePickParty}
                                onClear={handleClearParty}
                            />
                        </div>
                    )}

                    {cfg.showCustomer && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">
                                    {isSales ? "Name (if not found above)" : "Customer Name"}
                                </Label>
                                <Input
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="e.g. Ramesh Borah"
                                    className="h-9 text-sm"
                                    autoFocus={!isSales}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Phone</Label>
                                <Input
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="e.g. 9876543210"
                                    className="h-9 text-sm"
                                />
                            </div>
                        </div>
                    )}

                    {cfg.showChannel && (
                        <div className="space-y-1.5">
                            <Label className="text-xs">How did they reach us?</Label>
                            <Select value={channel} onValueChange={setChannel}>
                                <SelectTrigger className="h-9 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CHANNELS.map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-xs">
                            {logType === "internal" ? "Request *" : "Query / Problem *"}
                        </Label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={cfg.placeholder}
                            className="h-9 text-sm"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Extra notes <span className="text-muted-foreground">(optional)</span></Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Any extra detail that will help the team…"
                            rows={2}
                            className="text-sm resize-none"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <Button type="button" variant="outline" className="flex-1 h-9" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" className="flex-1 h-9" disabled={submitting}>
                            {submitting ? "Logging…" : "Log it →"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function UniversalCustomerPanel() {
    const [activeLog, setActiveLog] = useState<LogType | null>(null);

    return (
        <>
            <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-6 py-3.5 flex items-center gap-2">
                    <PhoneCall size={15} className="text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">Quick Customer &amp; Team Actions</span>
                    <span className="ml-2 text-xs text-muted-foreground">— for every staff member, any channel</span>
                </div>

                <div className="p-5 space-y-5">
                    {/* Search row */}
                    <div className="flex gap-4 flex-wrap sm:flex-nowrap">
                        <ProductLookup />
                        <div className="hidden sm:block w-px bg-border self-stretch" />
                        <RepairStatusLookup />
                    </div>

                    {/* Log buttons row */}
                    <div className="flex items-center gap-2 flex-wrap border-t border-border pt-4">
                        <span className="text-xs text-muted-foreground font-medium mr-1">Log a new query →</span>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 border-green-200 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-300"
                            onClick={() => setActiveLog("sales")}
                        >
                            <PhoneCall size={13} />
                            Sales Query
                        </Button>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:border-teal-300"
                            onClick={() => setActiveLog("helpdesk")}
                        >
                            <HeadphonesIcon size={13} />
                            Customer Problem
                        </Button>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:border-purple-300"
                            onClick={() => setActiveLog("internal")}
                        >
                            <ClipboardList size={13} />
                            Internal Request
                        </Button>
                    </div>
                </div>
            </div>

            {/* Log dialogs */}
            {(["sales", "helpdesk", "internal"] as LogType[]).map((type) => (
                <QuickLogDialog
                    key={type}
                    logType={type}
                    open={activeLog === type}
                    onClose={() => setActiveLog(null)}
                />
            ))}
        </>
    );
}
