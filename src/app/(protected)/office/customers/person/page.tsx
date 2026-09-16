"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    User, Building2,
    Smartphone, Loader2, ArrowLeft, RefreshCw, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
import { moduleSelectedStyle, moduleTint } from "@/shared/lib/format/moduleTheme";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { cn } from "@/shared/lib/format/utils";
import { DEFAULT_PARTY_SORT, sortParties, type PartySort } from "@/modules/customer/lib/partySort";
import { PartySortToggle } from "@/modules/customer/components/PartySortToggle";
import { PartyInactiveToggle } from "@/modules/customer/components/PartyInactiveToggle";
import { useDebouncedValue, usePartyBrowseList, useRealtimeTopics, type BrowseListRow } from "@/shared/hooks";
import type { Party } from "@/shared/lib/parties";
import { PRIORITY_META } from "@/utils/constants";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { phoneError, emailError } from "@/shared/components/PartySearchAndCreate";
import type { Ticket, CustomerDevice } from "@/modules/customer/lib/customerTypes";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import PersonProfileTab from "@/modules/customer/components/PersonProfileTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { TransactionsTable, type CustomerTransactions } from "@/modules/customer/components/TransactionsTable";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import { LoyaltyPanel } from "@/modules/loyalty/components/LoyaltyPanel";
import CustomerQualityTab from "@/modules/customer/components/CustomerQualityTab";
import { PartyOutstandingsPanel } from "@/modules/accountancy/components/PartyOutstandingsPanel";
import PartyBankTab from "@/modules/customer/components/PartyBankTab";
import { useActivePartyStore } from "@/store/activePartyStore";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { PartyAvatar } from "@/modules/customer/components/PartyAvatar";
import { PartyBalanceChip } from "@/modules/customer/components/PartyBalanceChip";
import { PartyDetailHeader } from "@/modules/customer/components/PartyDetailHeader";

interface CustomerListItem extends BrowseListRow {
    phone: string | null;
    email: string | null;
    _count: { companies: number; devices: number };
    /** `balance`/`normalBalance` are null ONLY on a `fromCache` placeholder row —
     *  the cache carries identity, never money — and the row renders them as
     *  pending rather than as a number. A live row always has both. */
    account: { id: number; balance: number | null; normalBalance: "DEBIT" | "CREDIT" | null } | null;
}

interface CustomerDetail {
    id: number;
    accountId: number;
    creditLimit: string | null;
    accountGroupName: string | null;
    customerGroupId: number | null;
    openingBalance: string | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: string | null;
    isActive: boolean;
    noDiscount: boolean;
    qualityLog: unknown;
    /** The party's own bank account (how we pay them) — see PartyBankTab. */
    bankJson: unknown;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    aliases: string[];
    createdAt: string;
    devices: CustomerDevice[];
    companies: { id: number; company: { id: number; name: string; phone: string | null; accountId: number } }[];
    phones: { id: number; phone: string; label: string | null; isPrimary: boolean }[];
    emails: { id: number; email: string; label: string | null; isPrimary: boolean }[];
}

/** A cached party as a list row, for the instant paint before the first live
 *  page lands. Money is left null on purpose — see `CustomerListItem.account`.
 *  Module scope so its identity is stable across renders. */
const placeholderFromCache = (p: Party): CustomerListItem => ({
    id: p.id,
    name: p.name,
    // The cache only ever holds active parties.
    isActive: true,
    phone: p.phones[0] ?? null,
    email: p.emails[0] ?? null,
    account: p.accountId ? { id: p.accountId, balance: null, normalBalance: null } : null,
    // Counts are a live-only join; 0 renders as "no badge", which is the same
    // thing this row shows while it is still a placeholder.
    _count: { companies: 0, devices: 0 },
    fromCache: true,
});

type Tab = "transactions" | "outstanding" | "profile" | "bank" | "tickets" | "devices" | "companies" | "loyalty" | "quality";

export default function CustomersPage() {
    const { data: session } = useSession();
    const [sort, setSort] = useState<PartySort>(DEFAULT_PARTY_SORT);
    const [showInactive, setShowInactive] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CustomerDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("transactions");
    // Quick Actions read the open profile so a party-facing voucher opens with
    // this party in place. Cleared when the profile closes or the page unmounts.
    const setActiveParty = useActivePartyStore((s) => s.setParty);
    useEffect(() => {
        setActiveParty(detail ? {
            kind: "customer",
            id: detail.id,
            name: detail.name,
            phone: detail.phone,
            accountId: detail.accountId,
        } : null);
        return () => setActiveParty(null);
    }, [detail, setActiveParty]);
    const [transactions, setTransactions] = useState<CustomerTransactions | null>(null);
    const [txLoading, setTxLoading] = useState(false);
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [linkKey, setLinkKey] = useState(0);

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [saving, setSaving] = useState(false);

    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // hasPermissionWithScope covers admin:bypass AND the CRUD ladder (only the
    // highest rung is stored — e.g. customers:delete implies edit).
    const canManageUsers = hasPermissionWithScope(perms, PERMISSIONS.USERS_EDIT);
    const canManageLoyalty = hasPermissionWithScope(perms, PERMISSIONS.LOYALTY_EDIT);
    const canEditCustomer = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_EDIT);
    const canDeleteCustomer = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_DELETE);
    // Without this grant the list hides suppliers (Sundry Creditors) — customers only.
    const canSeeCreditors = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);

    const router = useRouter();

    // Server-side search: the list holds only what the API returns for the
    // current query. Empty query → newest page, 50 at a time, growing as the
    // panel is scrolled — see `usePartyBrowseList`. Every page fetched, browsed
    // or searched, also tops up the same cache the till reads.
    const debouncedSearch = useDebouncedValue(search, 300);

    const { items: customers, loadingMore, loadMore, refresh, updateItem } = usePartyBrowseList<CustomerListItem>({
        type: "customer",
        apiPath: "/api/person",
        search: debouncedSearch.trim(),
        sort,
        hideCreditors: !canSeeCreditors,
        includeInactive: showInactive,
        errorMessage: "Failed to load customers",
        cachePlaceholder: placeholderFromCache,
    });

    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            setTransactions(null);
            return;
        }
        setDetailLoading(true);
        setTransactions(null);
        axios.get<CustomerDetail>(`/api/person/${selectedId}`)
            .then((response) => {
                setDetail(response.data);
                setTab("transactions");
            })
            .catch(() => toast.error("Failed to load customer"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (selectedId !== null) setSelectedId(null);
            else router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router, selectedId]);

    const handleTabChange = (next: Tab) => { setTab(next); };

    // Re-fetch after a link is added (CustomerLinkPanel), to get fresh companies list.
    const handleLinked = useCallback(() => {
        if (!selectedId) return;
        setLinkKey(k => k + 1);
        axios.get<CustomerDetail>(`/api/person/${selectedId}`)
            .then((res) => setDetail(res.data))
            .catch(() => { });
    }, [selectedId]);

    // Re-fetch after profile edits (name/address/phones/emails saved). Patches
    // the loaded row's name in place — the rest of a rename doesn't change
    // which page it belongs on, so a full reload would be wasted work.
    const refetchDetail = useCallback(() => {
        if (!selectedId) return;
        axios.get<CustomerDetail>(`/api/person/${selectedId}`)
            .then((res) => {
                setDetail(res.data);
                updateItem(selectedId, { name: res.data.name } as Partial<CustomerListItem>);
            })
            .catch(() => { });
    }, [selectedId, updateItem]);

    // Deleted (hard) or deactivated — either way it drops out of the isActive
    // list, so close the detail and reload.
    const handleDeleted = useCallback(() => {
        setSelectedId(null);
        void refresh();
    }, [refresh]);

    // Reactivated — refresh both the open detail and the list (badge/row updates).
    const handleReactivated = useCallback(() => {
        refetchDetail();
        void refresh();
    }, [refetchDetail, refresh]);

    // Load (or reload) transactions for the current customer + period.
    //
    // `quiet` is a re-read underneath someone who is already reading the statement
    // — the replica caught up, nothing was asked for. It must not blank the table
    // behind a spinner (AGENTS.md §7: show cached data while refreshing, no blank
    // flicker), and it must not raise a toast either: a background read that fails
    // is not something the user did, and the next cycle will try again anyway.
    // The loud path is unchanged — first open, a date change, the Refresh button.
    const loadTransactions = useCallback((f: string, t: string, quiet = false) => {
        if (!selectedId) return;
        if (!quiet) setTxLoading(true);
        axios.get<CustomerTransactions>(`/api/person/${selectedId}/transactions?from=${f}&to=${t}`)
            .then((r) => setTransactions(r.data))
            .catch(() => { if (!quiet) toast.error("Failed to load transactions"); })
            .finally(() => { if (!quiet) setTxLoading(false); });
    }, [selectedId]);

    // Auto-load transactions when the tab is active and not yet loaded.
    useEffect(() => {
        if (!selectedId || tab !== "transactions" || transactions) return;
        loadTransactions(from, to);
    }, [selectedId, tab, transactions, from, to, loadTransactions]);

    // A receipt made at Head Office reaches this till's replica a moment later, and
    // until now the statement went on showing the old chips — "Due" against money
    // that was already linked — until someone pressed Refresh. On a counter this
    // fires only after the sync worker has committed the rows; on the web it is the
    // Supabase channel as before. Either way the party's books follow the books.
    useRealtimeTopics(["ledger"], () => loadTransactions(from, to, true), tab === "transactions");

    // The same for the party list itself — a customer added or renamed on another
    // machine appears here without F5.
    useRealtimeTopics(["parties"], refresh);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (form.phone.trim()) {
            const err = phoneError(form.phone);
            if (err) { toast.error(err); return; }
        }
        if (form.email.trim()) {
            const err = emailError(form.email);
            if (err) { toast.error(err); return; }
        }
        setSaving(true);
        try {
            const response = await axios.post<CustomerListItem>("/api/person", {
                name: form.name,
                phones: form.phone ? [form.phone] : [],
                emails: form.email ? [form.email] : [],
                address: form.address,
            });
            toast.success("Customer created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "" });
            await refresh();
            setSelectedId(response.data.id);
        } catch {
            toast.error("Failed to create customer");
        } finally {
            setSaving(false);
        }
    };

    const allTickets: (Ticket & { device: CustomerDevice })[] = detail
        ? detail.devices.flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    const sortedCustomers = useMemo(
        () => sortParties(customers, sort, { name: (c) => c.name, balance: (c) => c.account?.balance ?? 0 }),
        [customers, sort],
    );

    return (
        <div className="flex h-full flex-col">
            <BreadcrumbBar className="flex items-center gap-2 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Link href="/office/customers" className="transition-colors hover:text-foreground">Customers</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">Persons</span>
                </nav>
            </BreadcrumbBar>
            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Person"
                    icon={<User size={16} className="text-primary" />}
                    count={customers.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search name or phone…"
                    onAdd={() => setShowCreate(true)}
                    toolbar={
                        <div className="flex justify-between">
                            <PartySortToggle sort={sort} onChange={setSort} />
                            <PartyInactiveToggle checked={showInactive} onChange={setShowInactive} visible={canDeleteCustomer} />
                        </div>
                    }
                    isEmpty={customers.length === 0}
                    emptyMessage={search ? "No matches" : "No customers yet"}
                    onScrollNearBottom={loadMore}
                >
                    {sortedCustomers.map((customer) => (
                        <Button
                            key={customer.id}
                            asChild
                            variant="ghost"
                            className={cn(
                                "h-auto w-full justify-start rounded-none border-b px-4 py-3",
                                !customer.isActive && "opacity-50",
                            )}
                            style={selectedId === customer.id ? moduleSelectedStyle("customers") : undefined}
                        >
                            <Link
                                href={`/office/customers/${customer.account?.id ?? "#"}`}
                                onClick={(e) => {
                                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                                    e.preventDefault();
                                    setSelectedId(customer.id);
                                }}
                            >
                                <div className="flex w-full items-center gap-3 text-left">
                                    <PartyAvatar name={customer.name} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{customer.name}</p>
                                        <div className="mt-0.5 flex items-center justify-between gap-2">
                                            <p className="truncate text-xs text-muted-foreground">{customer.phone || "No phone"}</p>
                                            {customer.account && (
                                                <PartyBalanceChip
                                                    balance={customer.account.balance}
                                                    normalBalance={customer.account.normalBalance}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    {!customer.isActive && (
                                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                            Inactive
                                        </span>
                                    )}
                                    {customer._count.devices > 0 && (
                                        <span className="text-xs text-muted-foreground">{customer._count.devices}d</span>
                                    )}
                                </div>
                            </Link>
                        </Button>
                    ))}
                    {loadingMore && (
                        <p className="py-3 text-center text-xs text-muted-foreground">Loading more…</p>
                    )}
                </EntityListPanel>

                <section
                    className="flex flex-1 flex-col overflow-hidden"
                    style={{ backgroundColor: moduleTint("customers", 6) }}
                >
                    {!selectedId && (
                        <CustomerEmptyState icon={<User size={40} strokeWidth={1} />} message="Select a customer to view activity" />
                    )}

                    {selectedId && detailLoading && (
                        <div className="flex flex-1 items-center justify-center text-muted-foreground">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    )}

                    {selectedId && !detailLoading && detail && (
                        <>
                            {/* ── Header ── */}
                            <PartyDetailHeader
                                name={detail.name}
                                phone={detail.phone}
                                address={detail.address}
                                email={detail.email}
                                createdAt={detail.createdAt}
                                socialHref={`/office/social/users/${detail.id}`}
                                chips={[
                                    { key: "devices", icon: <Smartphone size={11} />, text: `${detail.devices.length} device${detail.devices.length !== 1 ? "s" : ""}` },
                                    { key: "companies", icon: <Building2 size={11} />, text: `${detail.companies.length} compan${detail.companies.length !== 1 ? "ies" : "y"}` },
                                    { key: "tickets", text: `${allTickets.length} ticket${allTickets.length !== 1 ? "s" : ""}` },
                                ]}
                            />

                            {/* ── Tabs ── */}
                            <ModuleTabs
                                module="customers"
                                tabs={["transactions", "outstanding", "profile", "bank", "tickets", "devices", "companies", "loyalty", "quality"] as const satisfies readonly Tab[]}
                                active={tab}
                                onChange={handleTabChange}
                            />

                            {/* ── Tab content ── */}
                            <div className={`flex-1 overflow-y-auto ${tab === "transactions" ? "" : "p-6"}`}>

                                {/* Profile — inline editing */}
                                {tab === "profile" && (
                                    <PersonProfileTab
                                        detail={detail}
                                        canEditCustomer={canEditCustomer}
                                        canManageUsers={canManageUsers}
                                        canDeleteCustomer={canDeleteCustomer}
                                        onSaved={refetchDetail}
                                        onConverted={(companyId) => router.push(`/office/customers/all?companyId=${companyId}`)}
                                        onDeleted={handleDeleted}
                                        onReactivated={handleReactivated}
                                    />
                                )}

                                {/* Bank — the party's own account, for paying them */}
                                {tab === "bank" && (
                                    <PartyBankTab
                                        key={`bank-${detail.id}`}
                                        party={{ kind: "person", id: detail.id, name: detail.name }}
                                        initialBank={detail.bankJson}
                                        canEdit={canEditCustomer}
                                        onSaved={refetchDetail}
                                    />
                                )}

                                {/* Tickets */}
                                {tab === "tickets" && (
                                    allTickets.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">🎫</span>} message="No tickets for this customer yet" />
                                    ) : (
                                        <Card>
                                            <CardContent className="px-0 pt-0">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Ticket</TableHead>
                                                            <TableHead>Device</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead>Priority</TableHead>
                                                            <TableHead>Date</TableHead>
                                                            <TableHead />
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {allTickets.map((ticket) => (
                                                            <TableRow key={ticket.id}>
                                                                <TableCell className="font-mono text-xs text-muted-foreground">#{ticket.id}</TableCell>
                                                                <TableCell>
                                                                    <span className="text-sm font-medium">{ticket.device.brand} {ticket.device.model}</span>
                                                                    <span className="block text-xs text-muted-foreground">{ticket.device.type}</span>
                                                                </TableCell>
                                                                <TableCell><Badge {...badgeColor(ticket.ticketStatus.color)}>{ticket.ticketStatus.label}</Badge></TableCell>
                                                                <TableCell><Badge className={PRIORITY_META[ticket.priority]?.color ?? ""}>{PRIORITY_META[ticket.priority]?.label ?? ticket.priority}</Badge></TableCell>
                                                                <TableCell className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                                                                <TableCell />
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )
                                )}

                                {/* Devices */}
                                {tab === "devices" && (
                                    detail.devices.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered yet" />
                                    ) : (
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {detail.devices.map((device) => (
                                                <Card key={device.id}>
                                                    <CardContent className="pt-4">
                                                        <div className="flex items-start gap-3">
                                                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                                                                <Smartphone size={16} className="text-muted-foreground" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-semibold">{device.brand} {device.model}</p>
                                                                <p className="text-xs text-muted-foreground">{device.type}</p>
                                                            </div>
                                                        </div>
                                                        <p className="mt-3 text-xs text-muted-foreground">{device.tickets.length} ticket{device.tickets.length !== 1 ? "s" : ""}</p>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    )
                                )}

                                {/* Companies — link management */}
                                {tab === "companies" && (
                                    <CustomerLinkPanel
                                        key={linkKey}
                                        customerId={detail.id}
                                        initialLinks={detail.companies}
                                        onLinked={handleLinked}
                                    />
                                )}

                                {/* Loyalty */}
                                {tab === "loyalty" && (
                                    <LoyaltyPanel accountId={detail.accountId} canManage={canManageLoyalty} />
                                )}

                                {/* Customer Quality — flag / rating / comments (internal-only) */}
                                {tab === "quality" && (
                                    <CustomerQualityTab
                                        key={`pq-${detail.id}`}
                                        party={{ kind: "person", id: detail.id }}
                                        initialNoDiscount={detail.noDiscount}
                                        initialQualityLog={detail.qualityLog}
                                        canEditCustomer={canEditCustomer}
                                        onSaved={refetchDetail}
                                    />
                                )}

                                {/* Outstanding — this party's open bills, settled from here */}
                                {tab === "outstanding" && (
                                    <PartyOutstandingsPanel
                                        key={`po-${detail.accountId}`}
                                        accountId={detail.accountId}
                                        partyName={detail.name}
                                    />
                                )}

                                {/* Transactions */}
                                {tab === "transactions" && (
                                    <>
                                        {/* Filter bar — matches the account-ledger controls */}
                                        <div className="flex items-center gap-3 border-b bg-card px-6 py-2.5 flex-wrap">
                                            <span className="text-sm font-semibold shrink-0">Transactions</span>
                                            <div className="flex items-center gap-2 ml-auto flex-wrap">
                                                <label className="text-xs text-muted-foreground">From</label>
                                                <TallyDateInput
                                                    value={from}
                                                    onValueChange={(v) => { setFrom(v); loadTransactions(v, to); }}
                                                    className="h-7 w-36 text-xs"
                                                />
                                                <label className="text-xs text-muted-foreground">To</label>
                                                <TallyDateInput
                                                    value={to}
                                                    onValueChange={(v) => { setTo(v); loadTransactions(from, v); }}
                                                    monthMode="end"
                                                    className="h-7 w-36 text-xs"
                                                />
                                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => loadTransactions(from, to)}>
                                                    <RefreshCw size={12} className="mr-1" />
                                                    Refresh
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => window.print()}>
                                                    <Printer size={12} />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="p-2">
                                            {txLoading ? (
                                                <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                            ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                                <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                            ) : (
                                                <TransactionsTable invVouchers={transactions.invVouchers} accountId={transactions.accountId} onChanged={() => loadTransactions(from, to)} />
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </section>
            </div>

            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Customer</DialogTitle>
                        <DialogDescription>Add a customer record for future tickets and device history.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} autoFocus />
                        </div>
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {saving ? "Creating…" : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
