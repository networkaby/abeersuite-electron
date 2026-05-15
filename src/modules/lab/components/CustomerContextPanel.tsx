"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
    X,
    Phone,
    Mail,
    MapPin,
    Star,
    Wrench,
    Receipt,
    ExternalLink,
    Building2,
    User,
    AlertTriangle,
    CreditCard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type PartyHit } from "@/shared/hooks/usePartySearch";
import CustomerHeadsUpStrip from "@/modules/lab/components/CustomerHeadsUpStrip";

// ── Types ──────────────────────────────────────────────────────────────────

interface DeviceWithTickets {
    id: number;
    type: string;
    brand: string;
    model: string;
    tickets: {
        id: string;
        ticketStatus: { label: string; color: string | null } | null;
    }[];
}

interface PersonDetail {
    id: number;
    name: string;
    address: string | null;
    createdAt: string;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    companies: { id: number; company: { id: number; name: string } }[];
    devices: DeviceWithTickets[];
}

interface CompanyDetail {
    id: number;
    name: string;
    address: string | null;
    createdAt: string;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    customers: { id: number; customer: { id: number; name: string } }[];
    devices: DeviceWithTickets[];
}

type PartyDetail = PersonDetail | CompanyDetail;

interface Invoice {
    id: number;
    number: string;
    status: string;
    issueDate: string;
    totalAmount: string; // Prisma Decimal → JSON string (rupees)
    amountPaid: string;
}

interface AccountDetail {
    id: number;
    balance: string;      // rupees
    creditLimit: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse a Prisma Decimal JSON string → plain number (rupees). */
function rupees(d: string | number | null | undefined): number {
    if (d == null) return 0;
    return parseFloat(String(d));
}

function fmtRs(val: number): string {
    return `₹${val.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function tenureLabel(createdAt: string): string {
    const months = Math.floor(
        (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    if (months < 1) return "New";
    if (months < 12) return `${months}mo`;
    const yrs = Math.floor(months / 12);
    const rem = months % 12;
    return rem > 0 ? `${yrs}y ${rem}mo` : `${yrs}y`;
}

/** Relationship star score: tenure (0-4) + tx bonus (0-1), capped at 5. */
function computeStars(createdAt: string, invoiceCount: number): number {
    const months = Math.floor(
        (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    return Math.min(Math.floor(months / 6) + (invoiceCount >= 3 ? 1 : 0), 5);
}

function StarRating({ stars }: { stars: number }) {
    return (
        <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
                <Star
                    key={i}
                    size={12}
                    className={
                        i < stars
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/25"
                    }
                />
            ))}
        </div>
    );
}

function isPersonDetail(d: PartyDetail): d is PersonDetail {
    return "companies" in d;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Slides in below the Universal Helper Search when a customer is picked.
 * Shows KYC details, computed relationship rating, account health, open
 * tickets, and recent invoices — giving the desk staff full context before
 * a single word is spoken.
 */
export default function CustomerContextPanel({
    party,
    onClose,
    onNewTicket,
    onViewFullProfile,
}: {
    party: PartyHit;
    onClose: () => void;
    onNewTicket?: () => void;
    /** When provided, the avatar+name header becomes a button that opens the full detail view. */
    onViewFullProfile?: () => void;
}) {
    const router = useRouter();

    const [detail, setDetail] = useState<PartyDetail | null>(null);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [account, setAccount] = useState<AccountDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setDetail(null);
        setInvoices([]);
        setAccount(null);
        setLoading(true);

        const tasks: Promise<void>[] = [];

        // Core KYC detail
        const detailUrl =
            party.type === "company"
                ? `/api/companies/${party.id}`
                : `/api/people/${party.id}`;
        tasks.push(
            axios
                .get<PartyDetail>(detailUrl)
                .then((r) => setDetail(r.data))
                .catch(() => {})
        );

        // Invoice / transaction history (person only — companies share the same invoices via account)
        if (party.type === "customer") {
            tasks.push(
                axios
                    .get<{ invoices: Invoice[] }>(`/api/people/${party.id}/transactions`)
                    .then((r) => setInvoices(r.data.invoices ?? []))
                    .catch(() => {})
            );
        }

        // Account balance + credit limit
        if (party.accountId) {
            tasks.push(
                axios
                    .get<AccountDetail>(`/api/accounts/${party.accountId}`)
                    .then((r) => setAccount(r.data))
                    .catch(() => {})
            );
        }

        Promise.all(tasks).finally(() => setLoading(false));
    }, [party.id, party.type, party.accountId]);

    // Flatten all tickets across devices (most recent first, already ordered by API)
    const allTickets = (detail?.devices ?? []).flatMap((d) =>
        d.tickets.map((t) => ({ ...t, device: d }))
    );
    const recentTickets = allTickets.slice(0, 4);
    const recentInvoices = invoices.slice(0, 5);

    const outstanding = rupees(account?.balance);
    const creditLimit = account?.creditLimit ? rupees(account.creditLimit) : null;
    const overLimit = creditLimit !== null && outstanding > creditLimit;

    const stars = detail ? computeStars(detail.createdAt, invoices.length) : 0;

    const profileUrl =
        party.type === "company"
            ? `/office/customers/companies`
            : `/office/customers/people`;

    return (
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-md">
            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                {/* Avatar + name — clickable when onViewFullProfile is provided */}
                <button
                    type="button"
                    onClick={onViewFullProfile}
                    disabled={!onViewFullProfile}
                    className={`flex flex-1 min-w-0 items-center gap-3 text-left ${onViewFullProfile ? "cursor-pointer rounded-lg p-1 -m-1 hover:bg-muted/60 transition-colors group" : "cursor-default"}`}
                    title={onViewFullProfile ? "Open full profile" : undefined}
                >
                    <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                            party.type === "company"
                                ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                                : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                        }`}
                    >
                        {party.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground truncate">
                                {detail?.name ?? party.name}
                            </span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                                {party.type === "company" ? "Company" : "Person"}
                            </Badge>
                        </div>
                        {!loading && detail && (
                            <div className="mt-0.5 flex items-center gap-2">
                                <StarRating stars={stars} />
                                <span className="text-[10px] text-muted-foreground">
                                    {tenureLabel(detail.createdAt)} · {allTickets.length} ticket
                                    {allTickets.length !== 1 ? "s" : ""} · {invoices.length} invoice
                                    {invoices.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                        )}
                        {onViewFullProfile && (
                            <span className="mt-0.5 text-[10px] text-primary/60 group-hover:text-primary flex items-center gap-0.5 transition-colors">
                                Open full profile →
                            </span>
                        )}
                    </div>
                </button>
                <button
                    onClick={onClose}
                    className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Close"
                >
                    <X size={15} />
                </button>
            </div>

            {loading ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Loading customer details…
                </div>
            ) : (
                <>
                    {/* ── KYC / Contact strip ── */}
                    <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 border-b border-border px-4 py-3 text-xs sm:grid-cols-2">
                        {detail?.phone && (
                            <span className="flex items-center gap-1.5 text-foreground">
                                <Phone size={11} className="shrink-0 text-muted-foreground" />
                                {detail.phone}
                            </span>
                        )}
                        {detail?.email && (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Mail size={11} className="shrink-0" />
                                <span className="truncate">{detail.email}</span>
                            </span>
                        )}
                        {detail?.address && (
                            <span className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2">
                                <MapPin size={11} className="shrink-0" />
                                <span className="truncate">{detail.address}</span>
                            </span>
                        )}
                        {detail?.gstin && (
                            <span className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2">
                                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-foreground">
                                    GST
                                </span>
                                {detail.gstin}
                            </span>
                        )}
                        {/* Linked company — shown for persons */}
                        {detail && isPersonDetail(detail) && detail.companies.length > 0 && (
                            <span className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2">
                                <Building2 size={11} className="shrink-0" />
                                {detail.companies.map((c) => c.company.name).join(", ")}
                            </span>
                        )}
                        {/* Linked contacts — shown for companies */}
                        {detail && !isPersonDetail(detail) && detail.customers.length > 0 && (
                            <span className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2">
                                <User size={11} className="shrink-0" />
                                {detail.customers
                                    .slice(0, 3)
                                    .map((c) => c.customer.name)
                                    .join(", ")}
                                {detail.customers.length > 3 &&
                                    ` +${detail.customers.length - 3} more`}
                            </span>
                        )}
                    </div>

                    {/* ── Account health bar ── */}
                    {account && (
                        <div
                            className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs ${
                                overLimit ? "bg-destructive/5" : ""
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <CreditCard size={12} className="text-muted-foreground" />
                                <span className="text-muted-foreground">Outstanding:</span>
                                <span
                                    className={`font-semibold ${
                                        outstanding <= 0
                                            ? "text-emerald-600"
                                            : overLimit
                                            ? "text-destructive"
                                            : "text-amber-600"
                                    }`}
                                >
                                    {outstanding > 0 ? fmtRs(outstanding) : "Nil"}
                                </span>
                            </span>
                            {creditLimit !== null && (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <span>Limit:</span>
                                    <span className="font-medium text-foreground">
                                        {fmtRs(creditLimit)}
                                    </span>
                                </span>
                            )}
                            {overLimit && (
                                <span className="flex items-center gap-1 font-medium text-destructive">
                                    <AlertTriangle size={11} />
                                    Over limit
                                </span>
                            )}
                        </div>
                    )}

                    {/* ── Heads-up strip — proactive prompts (mock data for now) ── */}
                    <CustomerHeadsUpStrip accountId={party.accountId} />

                    {/* ── Tickets + Invoices two-column ── */}
                    <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        {/* Recent tickets */}
                        <div className="px-4 py-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Recent Tickets
                            </div>
                            {recentTickets.length === 0 ? (
                                <p className="text-[11px] italic text-muted-foreground">
                                    No repair history
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {recentTickets.map((t) => (
                                        <li key={t.id}>
                                            <button
                                                type="button"
                                                className="flex w-full items-start gap-2 text-left hover:opacity-80"
                                                onClick={() =>
                                                    router.push(
                                                        `/office/repairing/tickets/${t.id}`
                                                    )
                                                }
                                            >
                                                <Wrench
                                                    size={11}
                                                    className="mt-0.5 shrink-0 text-orange-600"
                                                />
                                                <div className="min-w-0">
                                                    <span className="font-mono text-xs font-medium">
                                                        {t.id}
                                                    </span>
                                                    <span className="mx-1 text-muted-foreground">
                                                        ·
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {t.device.brand} {t.device.model}
                                                    </span>
                                                    {t.ticketStatus && (
                                                        <span
                                                            className="ml-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-medium"
                                                            style={{
                                                                backgroundColor: t.ticketStatus.color
                                                                    ? `${t.ticketStatus.color}20`
                                                                    : undefined,
                                                                color:
                                                                    t.ticketStatus.color ?? undefined,
                                                            }}
                                                        >
                                                            {t.ticketStatus.label}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Recent invoices */}
                        <div className="px-4 py-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Recent Purchases
                            </div>
                            {recentInvoices.length === 0 ? (
                                <p className="text-[11px] italic text-muted-foreground">
                                    No invoices yet
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {recentInvoices.map((inv) => {
                                        const total = rupees(inv.totalAmount);
                                        const paid = rupees(inv.amountPaid);
                                        const due = total - paid;
                                        return (
                                            <li
                                                key={inv.id}
                                                className="flex items-center gap-2 text-[11px]"
                                            >
                                                <Receipt
                                                    size={11}
                                                    className="shrink-0 text-emerald-600"
                                                />
                                                <span className="font-mono text-xs">
                                                    {inv.number}
                                                </span>
                                                <span className="text-muted-foreground">
                                                    {new Date(inv.issueDate).toLocaleDateString(
                                                        "en-IN",
                                                        { day: "2-digit", month: "short" }
                                                    )}
                                                </span>
                                                <span className="ml-auto font-medium">
                                                    {fmtRs(total)}
                                                </span>
                                                {due > 0 && (
                                                    <span className="text-[10px] text-amber-600">
                                                        {fmtRs(due)} due
                                                    </span>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* ── Footer actions ── */}
                    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            onClick={() => router.push(profileUrl)}
                        >
                            <ExternalLink size={12} />
                            Full profile
                        </Button>
                        {onNewTicket && (
                            <Button
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={onNewTicket}
                            >
                                <Wrench size={12} />
                                New ticket
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
