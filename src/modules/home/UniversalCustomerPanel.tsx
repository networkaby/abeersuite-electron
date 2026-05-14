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
 *  2. Repair ticket status by ID — no permission gate
 *  3. Three log buttons → P6 (CRM/sales), P2 (helpdesk), P4 (internal)
 */

import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, ShoppingBag, Wrench, PhoneCall, HeadphonesIcon, ClipboardList,
    X, Package,
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
}

interface TicketPreview {
    id: number;
    status: string;
    ticketStatus: { label: string; color: string };
    device: {
        brand: string;
        model: string;
        account?: {
            person?: { name: string } | null;
            company?: { name: string } | null;
        } | null;
    };
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
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load full catalog once on first focus (same pattern as POS)
    async function ensureLoaded() {
        if (loaded) return;
        setLoading(true);
        try {
            const { data } = await axios.get<ProductOption[]>("/api/inventory/products/lookup");
            setProducts(data);
            setLoaded(true);
        } catch {
            toast.error("Could not load product catalog");
        } finally {
            setLoading(false);
        }
    }

    const q = query.toLowerCase().trim();
    const filtered = q.length < 2
        ? []
        : products.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                (p.brand?.name.toLowerCase().includes(q) ?? false),
          ).slice(0, 6);

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

function RepairStatusLookup() {
    const [query, setQuery] = useState("");
    const [ticket, setTicket] = useState<TicketPreview | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSearch() {
        const q = query.trim();
        if (!q) return;
        const numeric = /^\d+$/.test(q);
        if (!numeric) {
            toast.error("Please enter a numeric ticket ID");
            return;
        }
        setLoading(true);
        setNotFound(false);
        setTicket(null);
        try {
            const { data } = await axios.get<TicketPreview>(`/api/tickets/${q}`);
            setTicket(data);
        } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                setNotFound(true);
            } else {
                toast.error("Failed to fetch ticket");
            }
        } finally {
            setLoading(false);
        }
    }

    const customerName =
        ticket?.device.account?.person?.name ??
        ticket?.device.account?.company?.name ??
        "Unknown";

    return (
        <div className="flex-1 min-w-0">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Wrench size={12} />
                Repair ticket status
            </Label>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setTicket(null); setNotFound(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                        placeholder="Ticket ID (e.g. 1042)…"
                        className="pl-8 h-9 text-sm"
                    />
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSearch}
                    disabled={loading || !query.trim()}
                    className="h-9 px-3"
                >
                    {loading ? "…" : "Check"}
                </Button>
            </div>

            {ticket && (
                <div className="mt-2 rounded-md border border-border bg-card shadow-sm px-4 py-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <a
                            href={`/office/repairing/tickets/${ticket.id}`}
                            className="font-semibold text-primary hover:underline"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Ticket #{ticket.id}
                        </a>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${ticket.ticketStatus.color}`}>
                            {ticket.ticketStatus.label}
                        </span>
                    </div>
                    <p className="text-foreground font-medium">{customerName}</p>
                    <p className="text-xs text-muted-foreground">
                        {ticket.device.brand} {ticket.device.model}
                        {ticket.primaryOwner && <span className="ml-2">· Tech: {ticket.primaryOwner.name}</span>}
                    </p>
                    {ticket.expectedReturn && (
                        <p className="text-xs text-muted-foreground">
                            Expected: {new Date(ticket.expectedReturn).toLocaleDateString("en-IN")}
                        </p>
                    )}
                </div>
            )}

            {notFound && (
                <p className="text-xs text-destructive mt-2">Ticket #{query} not found.</p>
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

    const [title, setTitle] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [phone, setPhone] = useState("");
    const [channel, setChannel] = useState<string>(CHANNELS[0]);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            setTitle("");
            setCustomerName("");
            setPhone("");
            setChannel(CHANNELS[0]);
            setNotes("");
        }
    }, [open]);

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
                    {cfg.showCustomer && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Customer Name</Label>
                                <Input
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="e.g. Ramesh Borah"
                                    className="h-9 text-sm"
                                    autoFocus
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
                            autoFocus={!cfg.showCustomer}
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
