"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Building2,
    User, Smartphone, Loader2, RefreshCw, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { moduleSelectedStyle, moduleTint } from "@/shared/lib/format/moduleTheme";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { cn } from "@/shared/lib/format/utils";
import { DEFAULT_PARTY_SORT, sortParties, type PartySort } from "@/modules/customer/lib/partySort";
import { PartySortToggle } from "@/modules/customer/components/PartySortToggle";
import { PartyInactiveToggle } from "@/modules/customer/components/PartyInactiveToggle";
import { useDebouncedValue, usePartyBrowseList, useRealtimeTopics, type BrowseListRow } from "@/shared/hooks";
import type { Party } from "@/shared/lib/parties";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { phoneError, emailError } from "@/shared/components/PartySearchAndCreate";
import type { CustomerDevice } from "@/modules/customer/lib/customerTypes";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import CompanyProfileTab from "@/modules/customer/components/CompanyProfileTab";
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
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
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

interface CompanyListItem extends BrowseListRow {
    phone: string | null;
    companyReg: string | null;
    _count: { customers: number; devices: number };
    /** `balance`/`normalBalance` are null ONLY on a `fromCache` placeholder row —
     *  the cache carries identity, never money — and the row renders them as
     *  pending rather than as a number. A live row always has both. */
    account: { id: number; balance: number | null; normalBalance: "DEBIT" | "CREDIT" | null } | null;
}

/** A cached party as a list row, for the instant paint before the first live
 *  page lands. Money is left null on purpose — see `CompanyListItem.account`.
 *  Module scope so its identity is stable across renders. */
const placeholderFromCache = (p: Party): CompanyListItem => ({
    id: p.id,
    name: p.name,
    // The cache only ever holds active parties.
    isActive: true,
    phone: p.phones[0] ?? null,
    companyReg: null,
    account: p.accountId ? { id: p.accountId, balance: null, normalBalance: null } : null,
    // Counts are a live-only join; 0 renders as "no badge", which is the same
    // thing this row shows while it is still a placeholder.
    _count: { customers: 0, devices: 0 },
    fromCache: true,
});

interface CompanyDetail {
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
    companyReg: string | null;
    taxId: string | null;
    createdAt: string;
    devices: CustomerDevice[];
    customers: { id: number; customer: { id: number; accountId: number; name: string; phone: string | null } }[];
    contactRows: {
        phones: { id: number; value: string; label: string | null; isPrimary: boolean }[];
        emails: { id: number; value: string; label: string | null; isPrimary: boolean }[];
    } | null;
}

type Tab = "transactions" | "outstanding" | "profile" | "bank" | "contacts" | "devices" | "loyalty" | "quality";

export default function CompaniesPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // hasPermissionWithScope covers admin:bypass AND the CRUD ladder (only the
    // highest rung is stored — e.g. customers:delete implies edit).
    const canManageLoyalty = hasPermissionWithScope(perms, PERMISSIONS.LOYALTY_EDIT);
    // Companies share the Contacts (customers:*) permission set — see role page.
    const canEditCompany = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_EDIT);
    const canDeleteCompany = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_DELETE);
    // Without this grant the list hides suppliers (Sundry Creditors) — customers only.
    const canSeeCreditors = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);
    const [sort, setSort] = useState<PartySort>(DEFAULT_PARTY_SORT);
    const [showInactive, setShowInactive] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("transactions");
    // Quick Actions read the open profile so a party-facing voucher opens with
    // this party in place. Cleared when the profile closes or the page unmounts.
    const setActiveParty = useActivePartyStore((s) => s.setParty);
    useEffect(() => {
        setActiveParty(detail ? {
            kind: "company",
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
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [saving, setSaving] = useState(false);

    // Server-side search — let the DB match name / phone / reg across the whole
    // table instead of filtering the loaded page in the browser. Empty query →
    // newest page, 50 at a time, growing as the panel is scrolled — see
    // `usePartyBrowseList`. Every page fetched, browsed or searched, also tops
    // up the same cache the till reads.
    const debouncedSearch = useDebouncedValue(search, 300);

    const { items: companies, loadingMore, loadMore, refresh, updateItem } = usePartyBrowseList<CompanyListItem>({
        type: "company",
        apiPath: "/api/companies",
        search: debouncedSearch.trim(),
        sort,
        hideCreditors: !canSeeCreditors,
        includeInactive: showInactive,
        errorMessage: "Failed to load companies",
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
        axios.get<CompanyDetail>(`/api/companies/${selectedId}`)
            .then((response) => {
                setDetail(response.data);
                setTab("transactions");
            })
            .catch(() => toast.error("Failed to load company"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    // Load (or reload) transactions for the current company + period.
    // `quiet` is a re-read underneath someone already reading the statement — the
    // replica caught up, nothing was asked for. No spinner over data that is on
    // screen (AGENTS.md §7) and no toast: a background read that fails is not
    // something the user did, and the next cycle tries again. See the person page.
    const loadTransactions = useCallback((f: string, t: string, quiet = false) => {
        if (!selectedId) return;
        if (!quiet) setTxLoading(true);
        axios.get<CustomerTransactions>(`/api/companies/${selectedId}/transactions?from=${f}&to=${t}`)
            .then((r) => setTransactions(r.data))
            .catch(() => { if (!quiet) toast.error("Failed to load transactions"); })
            .finally(() => { if (!quiet) setTxLoading(false); });
    }, [selectedId]);

    // The party's books follow the books: on a counter this fires once the sync
    // worker has committed pulled rows into the replica, on the web it is the
    // Supabase channel as before.
    useRealtimeTopics(["ledger"], () => loadTransactions(from, to, true), tab === "transactions");
    useRealtimeTopics(["parties"], refresh);

    // Auto-load transactions when the tab is active and not yet loaded.
    useEffect(() => {
        if (!selectedId || tab !== "transactions" || transactions) return;
        loadTransactions(from, to);
    }, [selectedId, tab, transactions, from, to, loadTransactions]);

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

    // Re-fetch after a contact is linked (CompanyLinkPanel).
    const handleLinked = useCallback(() => {
        if (!selectedId) return;
        setLinkKey(k => k + 1);
        axios.get<CompanyDetail>(`/api/companies/${selectedId}`)
            .then((res) => setDetail(res.data))
            .catch(() => {});
    }, [selectedId]);

    // Re-fetch after profile edits saved (CompanyProfileEdit). Patches the
    // loaded row's name in place — a rename doesn't change which page it
    // belongs on, so a full reload would be wasted work.
    const refetchDetail = useCallback(() => {
        if (!selectedId) return;
        axios.get<CompanyDetail>(`/api/companies/${selectedId}`)
            .then((res) => {
                setDetail(res.data);
                updateItem(selectedId, { name: res.data.name } as Partial<CompanyListItem>);
            })
            .catch(() => {});
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

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("Company name is required"); return; }
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
            const response = await axios.post<CompanyListItem>("/api/companies", {
                name: form.name,
                phones: form.phone ? [form.phone] : [],
                emails: form.email ? [form.email] : [],
                address: form.address,
                companyReg: form.companyReg,
                taxId: form.taxId,
            });
            toast.success("Company created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
            await refresh();
            setSelectedId(response.data.id);
        } catch {
            toast.error("Failed to create company");
        } finally {
            setSaving(false);
        }
    };

    const sortedCompanies = useMemo(
        () => sortParties(companies, sort, { name: (c) => c.name, balance: (c) => c.account?.balance ?? 0 }),
        [companies, sort],
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <BreadcrumbBar className="flex items-center gap-2 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Link href="/office/customers" className="transition-colors hover:text-foreground">Customers</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">Companies</span>
                </nav>
            </BreadcrumbBar>

            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Companies"
                    icon={<Building2 size={16} className="text-primary" />}
                    count={companies.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search name, phone, reg…"
                    onAdd={() => setShowCreate(true)}
                    toolbar={
                        <>
                            <PartySortToggle sort={sort} onChange={setSort} />
                            <PartyInactiveToggle checked={showInactive} onChange={setShowInactive} visible={canDeleteCompany} />
                        </>
                    }
                    isEmpty={companies.length === 0}
                    emptyMessage={search ? "No matches" : "No companies yet"}
                    onScrollNearBottom={loadMore}
                >
                    {sortedCompanies.map((company) => (
                        <Button
                            key={company.id}
                            type="button"
                            variant="ghost"
                            className={cn(
                                "h-auto w-full justify-start rounded-none border-b px-4 py-3",
                                !company.isActive && "opacity-50",
                            )}
                            style={selectedId === company.id ? moduleSelectedStyle("customers") : undefined}
                            onClick={() => setSelectedId(company.id)}
                        >
                            <div className="flex w-full items-center gap-3 text-left">
                                <PartyAvatar name={company.name} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{company.name}</p>
                                    <div className="mt-0.5 flex items-center justify-between gap-2">
                                        <p className="truncate text-xs text-muted-foreground">{company.phone || "No phone"}</p>
                                        {company.account && (
                                            <PartyBalanceChip
                                                balance={company.account.balance}
                                                normalBalance={company.account.normalBalance}
                                            />
                                        )}
                                    </div>
                                </div>
                                {company._count.customers > 0 && (
                                    <span className="text-xs text-muted-foreground">{company._count.customers}c</span>
                                )}
                            </div>
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
                        <CustomerEmptyState icon={<Building2 size={40} strokeWidth={1} />} message="Select a company to view details" />
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
                                extra={detail.companyReg ? <span className="text-xs text-muted-foreground">Reg: {detail.companyReg}</span> : null}
                                createdAt={detail.createdAt}
                                socialHref={`/office/social/users/${detail.id}`}
                                chips={[
                                    { key: "contacts", icon: <User size={11} />, text: `${detail.customers.length} contact${detail.customers.length !== 1 ? "s" : ""}` },
                                    { key: "devices", icon: <Smartphone size={11} />, text: `${detail.devices.length} device${detail.devices.length !== 1 ? "s" : ""}` },
                                    { key: "tickets", text: `${detail.devices.flatMap((d) => d.tickets).length} ticket${detail.devices.flatMap((d) => d.tickets).length !== 1 ? "s" : ""}` },
                                ]}
                            />

                            {/* ── Tabs ── */}
                            <ModuleTabs
                                module="customers"
                                tabs={["transactions", "outstanding", "profile", "bank", "contacts", "devices", "loyalty", "quality"] as const satisfies readonly Tab[]}
                                active={tab}
                                onChange={handleTabChange}
                            />

                            {/* ── Tab content ── */}
                            <div className={`flex-1 overflow-y-auto ${tab === "transactions" ? "" : "p-6"}`}>

                                {/* Profile — inline editing */}
                                {tab === "profile" && (
                                    <CompanyProfileTab
                                        detail={detail}
                                        canEditCompany={canEditCompany}
                                        canDeleteCompany={canDeleteCompany}
                                        onSaved={refetchDetail}
                                        onConverted={(personId) => router.push(`/office/customers/all?personId=${personId}`)}
                                        onDeleted={handleDeleted}
                                        onReactivated={handleReactivated}
                                    />
                                )}

                                {/* Bank — the party's own account, for paying them */}
                                {tab === "bank" && (
                                    <PartyBankTab
                                        key={`bank-${detail.id}`}
                                        party={{ kind: "company", id: detail.id, name: detail.name }}
                                        initialBank={detail.bankJson}
                                        canEdit={canEditCompany}
                                        onSaved={refetchDetail}
                                    />
                                )}

                                {/* Contacts — link management */}
                                {tab === "contacts" && (
                                    <CompanyLinkPanel
                                        key={linkKey}
                                        companyId={detail.id}
                                        initialLinks={detail.customers}
                                        onLinked={handleLinked}
                                    />
                                )}

                                {/* Devices */}
                                {tab === "devices" && (
                                    detail.devices.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered to this company" />
                                    ) : (
                                        <Card>
                                            <CardContent className="px-0 pt-0">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Device</TableHead>
                                                            <TableHead>Type</TableHead>
                                                            <TableHead>Latest Ticket</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead>Tickets</TableHead>
                                                            <TableHead />
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {detail.devices.map((device) => {
                                                            const latest = device.tickets[0];
                                                            return (
                                                                <TableRow key={device.id}>
                                                                    <TableCell><span className="text-sm font-medium">{device.brand} {device.model}</span></TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{device.type}</TableCell>
                                                                    <TableCell className="font-mono text-xs text-muted-foreground">{latest ? `#${latest.id}` : "—"}</TableCell>
                                                                    <TableCell>{latest ? <Badge {...badgeColor(latest.ticketStatus.color)}>{latest.ticketStatus.label}</Badge> : "—"}</TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{device.tickets.length}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        {latest && (
                                                                            <Button asChild variant="link" size="sm">
                                                                                <Link href={`/office/repairing/tickets/${latest.id}`}>View</Link>
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )
                                )}

                                {/* Loyalty */}
                                {tab === "loyalty" && (
                                    <LoyaltyPanel accountId={detail.accountId} canManage={canManageLoyalty} />
                                )}

                                {/* Customer Quality — flag / rating / comments (internal-only) */}
                                {tab === "quality" && (
                                    <CustomerQualityTab
                                        key={`cq-${detail.id}`}
                                        party={{ kind: "company", id: detail.id }}
                                        initialNoDiscount={detail.noDiscount}
                                        initialQualityLog={detail.qualityLog}
                                        canEditCustomer={canEditCompany}
                                        onSaved={refetchDetail}
                                    />
                                )}

                                {/* Outstanding — this party's open bills, settled from here */}
                                {tab === "outstanding" && (
                                    <PartyOutstandingsPanel
                                        key={`co-${detail.accountId}`}
                                        accountId={detail.accountId}
                                        partyName={detail.name}
                                    />
                                )}

                                {/* Transactions */}
                                {tab === "transactions" && (
                                    <>
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
                                                {/* Where a deliberate re-read says so, now that it no longer
                                                    announces itself by blanking the table. */}
                                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => loadTransactions(from, to)} disabled={txLoading}>
                                                    <RefreshCw size={12} className={cn("mr-1", txLoading && "animate-spin")} />
                                                    Refresh
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => window.print()}>
                                                    <Printer size={12} />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="p-2">
                                            {/* The spinner is for having NOTHING to show, never for a re-read over a
                                                statement already on screen (AGENTS.md §7). Saving a bill-wise link from
                                                a row's Status chip used to throw the whole table out, collapse the page
                                                to a 64px spinner and lose the scroll position — and for nothing: on a
                                                counter that immediate read cannot see the new link yet, it is the
                                                replica's own quiet re-read a moment later that settles the row. The
                                                statement is cleared whenever the selected party changes, so a different
                                                party still gets the spinner rather than the last party's rows. Same rule
                                                as the Outstanding tab beside it (PartyOutstandingsPanel) and RecycleBin. */}
                                            {txLoading && !transactions ? (
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
                        <DialogTitle>New Company</DialogTitle>
                        <DialogDescription>Create a company record with optional registration and tax details.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
                        <div className="space-y-2">
                            <Label>Company Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} autoFocus />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted p-4">
                            <div className="space-y-2">
                                <Label>Company Reg</Label>
                                <Input value={form.companyReg} onChange={(e) => setForm((prev) => ({ ...prev, companyReg: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Tax ID / VAT</Label>
                                <Input value={form.taxId} onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                            <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
