"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import {
    ArrowLeft,
    Building2,
    Loader2,
    Smartphone,
    User,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { moduleSelectedStyle, moduleTint } from "@/shared/lib/format/moduleTheme";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { useDebouncedValue } from "@/shared/hooks";
import { LoyaltyPanel } from "@/modules/loyalty/components/LoyaltyPanel";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { DEFAULT_PARTY_SORT, sortParties, type PartySort } from "@/modules/customer/lib/partySort";
import { PartySortToggle } from "@/modules/customer/components/PartySortToggle";
import { PRIORITY_META } from "@/utils/constants";
import type { Ticket, CustomerDevice } from "@/modules/customer/lib/customerTypes";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { TransactionsTable, type CustomerTransactions } from "@/modules/customer/components/TransactionsTable";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
import PersonProfileTab from "@/modules/customer/components/PersonProfileTab";
import CompanyProfileTab from "@/modules/customer/components/CompanyProfileTab";
import CustomerQualityTab from "@/modules/customer/components/CustomerQualityTab";
import { PartyOutstandingsPanel } from "@/modules/accountancy/components/PartyOutstandingsPanel";
import PartyBankTab from "@/modules/customer/components/PartyBankTab";
import { PartyInactiveToggle } from "@/modules/customer/components/PartyInactiveToggle";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { PartyAvatar } from "@/modules/customer/components/PartyAvatar";
import { PartyBalanceChip } from "@/modules/customer/components/PartyBalanceChip";
import { PartyDetailHeader } from "@/modules/customer/components/PartyDetailHeader";

type AccountRef = { id: number; balance: number; normalBalance: "DEBIT" | "CREDIT" } | null;

type PersonRow = {
    id: number;
    name: string;
    phone: string | null;
    isActive: boolean;
    account: AccountRef;
};

type CompanyRow = {
    id: number;
    name: string;
    phone: string | null;
    isActive: boolean;
    account: AccountRef;
};

type CombinedListItem =
    | { kind: "person"; id: number; name: string; phone: string | null; isActive: boolean; accountId: number | null; account: AccountRef }
    | { kind: "company"; id: number; name: string; phone: string | null; isActive: boolean; accountId: number | null; account: AccountRef };

type PersonDetail = {
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
};

type CompanyDetail = {
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
};

type SelectedItem = { kind: "person" | "company"; id: number };
type PersonTab = "transactions" | "outstanding" | "profile" | "bank" | "tickets" | "devices" | "companies" | "loyalty" | "quality";
type CompanyTab = "transactions" | "outstanding" | "profile" | "bank" | "contacts" | "devices" | "loyalty" | "quality";


export default function AllCustomersPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const [people, setPeople] = useState<PersonRow[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
    const [sort, setSort] = useState<PartySort>(DEFAULT_PARTY_SORT);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<SelectedItem | null>(null);
    const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
    const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [personTab, setPersonTab] = useState<PersonTab>("transactions");
    const [companyTab, setCompanyTab] = useState<CompanyTab>("transactions");
    const [transactions, setTransactions] = useState<CustomerTransactions | null>(null);
    const [txLoading, setTxLoading] = useState(false);
    const [personLinkKey, setPersonLinkKey] = useState(0);
    const [companyLinkKey, setCompanyLinkKey] = useState(0);
    const [showInactive, setShowInactive] = useState(false);

    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // hasPermissionWithScope covers admin:bypass AND the CRUD ladder (only the
    // highest rung is stored — e.g. customers:delete implies edit).
    const canManageUsers = hasPermissionWithScope(perms, PERMISSIONS.USERS_EDIT);
    const canEditCustomer = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_EDIT);
    const canDeleteCustomer = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_DELETE);
    const canManageLoyalty = hasPermissionWithScope(perms, PERMISSIONS.LOYALTY_EDIT);
    // Without this grant both lists hide suppliers (Sundry Creditors) — customers only.
    const canSeeCreditors = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);

    // Server-side search across both lists. The old in-browser filter only saw
    // the first page of people the API returned, so matches beyond it vanished.
    const debouncedSearch = useDebouncedValue(search, 300);
    const reloadLists = useCallback(() => {
        const params = {
            ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
            ...(canSeeCreditors ? {} : { hideCreditors: 1 }),
            ...(showInactive ? { includeInactive: 1 } : {}),
        };
        axios.get<PersonRow[]>("/api/person", { params }).then((res) => setPeople(res.data)).catch(() => setPeople([]));
        axios.get<CompanyRow[]>("/api/companies", { params }).then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
    }, [debouncedSearch, canSeeCreditors, showInactive]);
    useEffect(() => { reloadLists(); }, [reloadLists]);
    // A customer created or edited on another PC appears in the list without F5.
    useRealtimeTopics(["parties"], reloadLists);

    // Pre-select a row from URL query params on mount.  Day Book / register
    // tables link here as /office/customers/all?personId=<id> or ?companyId=<id>
    // so clicking a party in those views opens the same 3-column layout with
    // the right customer already selected.
    const searchParams = useSearchParams();
    useEffect(() => {
        const personId = searchParams.get("personId");
        const companyId = searchParams.get("companyId");
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (personId) setSelected({ kind: "person", id: Number(personId) });
        else if (companyId) setSelected({ kind: "company", id: Number(companyId) });
        // Intentionally only react to query-param changes — list-click selection
        // is owned by the existing onClick handler below.
    }, [searchParams]);

    useEffect(() => {
        if (!selected) {
            const id = window.setTimeout(() => {
                setPersonDetail(null);
                setCompanyDetail(null);
                setTransactions(null);
                setDetailLoading(false);
            }, 0);
            return () => window.clearTimeout(id);
        }

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setDetailLoading(true);
            setTransactions(null);
            const finishLoading = () => { if (!cancelled) setDetailLoading(false); };

            if (selected.kind === "person") {
                axios
                    .get<PersonDetail>(`/api/person/${selected.id}`)
                    .then((res) => {
                        if (cancelled) return;
                        setPersonDetail(res.data);
                        setCompanyDetail(null);
                        setPersonTab("transactions");
                    })
                    .catch(() => { if (cancelled) return; setPersonDetail(null); setCompanyDetail(null); })
                    .finally(finishLoading);
                return;
            }

            axios
                .get<CompanyDetail>(`/api/companies/${selected.id}`)
                .then((res) => {
                    if (cancelled) return;
                    setCompanyDetail(res.data);
                    setPersonDetail(null);
                    setCompanyTab("transactions");
                })
                .catch(() => { if (cancelled) return; setCompanyDetail(null); setPersonDetail(null); })
                .finally(finishLoading);
        });

        return () => { cancelled = true; };
    }, [selected]);

    const handlePersonTabChange = (next: PersonTab) => {
        setPersonTab(next);
    };

    const handleCompanyTabChange = (next: CompanyTab) => {
        setCompanyTab(next);
    };

    // `silent` is a re-read underneath someone who is already reading the
    // statement — the books moved on another machine, or a bill-wise link was just
    // saved from a row's Status chip. It must not blank the table (AGENTS.md §7).
    // The loud path is the first open of the tab, where there is nothing to keep.
    const reloadTransactions = useCallback((silent = false) => {
        if (!selected) return;
        if (!silent) setTxLoading(true);
        const url =
            selected.kind === "person"
                ? `/api/person/${selected.id}/transactions`
                : `/api/companies/${selected.id}/transactions`;

        axios
            .get<CustomerTransactions>(url)
            .then((r) => setTransactions(r.data))
            .catch(() => { })
            .finally(() => { if (!silent) setTxLoading(false); });
    }, [selected]);
    // The open party's statement follows the books — silently, because nobody
    // asked for this read, and only while a statement is actually on screen, so a
    // ledger signal costs the other tabs nothing.
    const showingTransactions = selected !== null
        && (selected.kind === "person" ? personTab === "transactions" : companyTab === "transactions");
    useRealtimeTopics(["ledger"], () => reloadTransactions(true), showingTransactions);

    useEffect(() => {
        if (!selected) return;
        const wantsTransactions =
            (selected.kind === "person" && personTab === "transactions")
            || (selected.kind === "company" && companyTab === "transactions");
        if (!wantsTransactions || transactions) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect
        reloadTransactions();
    }, [selected, personTab, companyTab, transactions, reloadTransactions]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (selected !== null) setSelected(null);
            else router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router, selected]);

    const handlePersonLinked = useCallback(() => {
        if (!selected || selected.kind !== "person") return;
        setPersonLinkKey(k => k + 1);
        axios.get<PersonDetail>(`/api/person/${selected.id}`)
            .then((res) => setPersonDetail(res.data))
            .catch(() => { });
    }, [selected]);

    const handleCompanyLinked = useCallback(() => {
        if (!selected || selected.kind !== "company") return;
        setCompanyLinkKey(k => k + 1);
        axios.get<CompanyDetail>(`/api/companies/${selected.id}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => { });
    }, [selected]);

    const refetchPersonDetail = useCallback(() => {
        if (!selected || selected.kind !== "person") return;
        axios.get<PersonDetail>(`/api/person/${selected.id}`)
            .then((res) => setPersonDetail(res.data))
            .catch(() => { });
    }, [selected]);

    const refetchCompanyDetail = useCallback(() => {
        if (!selected || selected.kind !== "company") return;
        axios.get<CompanyDetail>(`/api/companies/${selected.id}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => { });
    }, [selected]);

    // Deleted (hard) or deactivated — either way it drops out of the isActive
    // lists, so close the detail and reload both.
    const handleDeleted = useCallback(() => {
        setSelected(null);
        reloadLists();
    }, [reloadLists]);

    // Reactivated — refresh both the open detail and the lists (badge/row updates).
    const handlePersonReactivated = useCallback(() => {
        refetchPersonDetail();
        reloadLists();
    }, [refetchPersonDetail, reloadLists]);

    const handleCompanyReactivated = useCallback(() => {
        refetchCompanyDetail();
        reloadLists();
    }, [refetchCompanyDetail, reloadLists]);

    const merged = useMemo<CombinedListItem[]>(
        () => sortParties(
            [
                ...people.map((p) => ({ kind: "person" as const, id: p.id, name: p.name, phone: p.phone, isActive: p.isActive, accountId: p.account?.id ?? null, account: p.account })),
                ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, phone: c.phone, isActive: c.isActive, accountId: c.account?.id ?? null, account: c.account })),
            ],
            sort,
            { name: (item) => item.name, balance: (item) => item.account?.balance ?? 0 },
        ),
        [people, companies, sort]
    );

    const personTickets: (Ticket & { device: CustomerDevice })[] = personDetail
        ? personDetail.devices
            .flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <BreadcrumbBar className="flex items-center gap-2 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {searchParams.get("from") === "daybook" && (
                        <>
                            <Link href="/office/accountancy/reports/day-book" className="transition-colors hover:text-foreground">Day Book</Link>
                            <span>/</span>
                        </>
                    )}
                    <Link href="/office/customers" className="transition-colors hover:text-foreground">Customers</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">All</span>
                </nav>
            </BreadcrumbBar>
            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="All Customers"
                    icon={<User size={15} className="text-primary" />}
                    count={people.length + companies.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search name or phone…"
                    toolbar={
                        <div className="flex justify-between">
                            <PartySortToggle sort={sort} onChange={setSort} />
                            <PartyInactiveToggle checked={showInactive} onChange={setShowInactive} visible={canDeleteCustomer} />
                        </div>
                    }
                    isEmpty={merged.length === 0}
                    emptyMessage={search ? "No matches" : "No customers yet"}
                >
                    {merged.map((item) => {
                        const Icon = item.kind === "person" ? User : Building2;
                        const isActive = selected?.kind === item.kind && selected.id === item.id;
                        return (
                            <Button
                                key={`${item.kind}-${item.id}`}
                                asChild
                                variant="ghost"
                                className={cn(
                                    "h-auto w-full justify-start rounded-none border-b px-4 py-3",
                                    !item.isActive && "opacity-50",
                                )}
                                style={isActive ? moduleSelectedStyle("customers") : undefined}
                            >
                                <Link
                                    href={`/office/customers/${item.accountId ?? "#"}`}
                                    onClick={(e) => {
                                        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                                        e.preventDefault();
                                        setSelected({ kind: item.kind, id: item.id });
                                    }}
                                >
                                    <div className="flex w-full items-center gap-3 text-left">
                                        <PartyAvatar name={item.name} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{item.name}</p>
                                            <div className="mt-0.5 flex items-center justify-between gap-2">
                                                <p className="truncate text-xs text-muted-foreground">{item.phone || "No phone"}</p>
                                                {item.account && (
                                                    <PartyBalanceChip
                                                        balance={item.account.balance}
                                                        normalBalance={item.account.normalBalance}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                        {!item.isActive && (
                                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                Inactive
                                            </span>
                                        )}
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                            <Icon size={10} className="mr-1" />
                                            {item.kind === "person" ? "Person" : "Company"}
                                        </Badge>
                                    </div>
                                </Link>
                            </Button>
                        );
                    })}
                </EntityListPanel>

                <section
                    className="flex flex-1"
                    style={{ backgroundColor: moduleTint("customers", 6) }}
                >
                    {!selected && (
                        <CustomerEmptyState message="Select a person or company from the list to open details." />
                    )}

                    {selected && detailLoading && (
                        <div className="m-auto text-muted-foreground">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    )}

                    {selected && !detailLoading && personDetail && (
                        <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
                            <PartyDetailHeader
                                name={personDetail.name}
                                phone={personDetail.phone}
                                address={personDetail.address}
                                email={personDetail.email}
                                createdAt={personDetail.createdAt}
                                socialHref={`/office/social/users/${personDetail.id}`}
                                chips={[
                                    { key: "devices", icon: <Smartphone size={11} />, text: `${personDetail.devices.length} device${personDetail.devices.length !== 1 ? "s" : ""}` },
                                    { key: "companies", icon: <Building2 size={11} />, text: `${personDetail.companies.length} compan${personDetail.companies.length !== 1 ? "ies" : "y"}` },
                                    { key: "tickets", text: `${personTickets.length} ticket${personTickets.length !== 1 ? "s" : ""}` },
                                ]}
                            />

                            <ModuleTabs
                                module="customers"
                                tabs={["transactions", "outstanding", "profile", "bank", "tickets", "devices", "companies", "loyalty", "quality"] as const satisfies readonly PersonTab[]}
                                active={personTab}
                                onChange={handlePersonTabChange}
                            />

                            <div className={`flex-1 overflow-y-auto ${personTab === "transactions" ? "" : "p-6"}`}>
                                {personTab === "profile" && (
                                    <PersonProfileTab
                                        detail={personDetail}
                                        canEditCustomer={canEditCustomer}
                                        canManageUsers={canManageUsers}
                                        canDeleteCustomer={canDeleteCustomer}
                                        onSaved={refetchPersonDetail}
                                        onConverted={(companyId) => setSelected({ kind: "company", id: companyId })}
                                        onDeleted={handleDeleted}
                                        onReactivated={handlePersonReactivated}
                                    />
                                )}

                                {personTab === "bank" && (
                                    <PartyBankTab
                                        key={`bank-p-${personDetail.id}`}
                                        party={{ kind: "person", id: personDetail.id, name: personDetail.name }}
                                        initialBank={personDetail.bankJson}
                                        canEdit={canEditCustomer}
                                        onSaved={refetchPersonDetail}
                                    />
                                )}

                                {personTab === "tickets" && (
                                    personTickets.length === 0 ? (
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
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {personTickets.map((ticket) => (
                                                            <TableRow key={ticket.id}>
                                                                <TableCell className="font-mono text-xs text-muted-foreground">#{ticket.id}</TableCell>
                                                                <TableCell>
                                                                    <span className="text-sm font-medium">{ticket.device.brand} {ticket.device.model}</span>
                                                                    <span className="block text-xs text-muted-foreground">{ticket.device.type}</span>
                                                                </TableCell>
                                                                <TableCell><Badge {...badgeColor(ticket.ticketStatus.color)}>{ticket.ticketStatus.label}</Badge></TableCell>
                                                                <TableCell><Badge className={PRIORITY_META[ticket.priority]?.color ?? ""}>{PRIORITY_META[ticket.priority]?.label ?? ticket.priority}</Badge></TableCell>
                                                                <TableCell className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )
                                )}

                                {personTab === "devices" && (
                                    personDetail.devices.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered yet" />
                                    ) : (
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {personDetail.devices.map((device) => (
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

                                {personTab === "companies" && (
                                    <CustomerLinkPanel
                                        key={personLinkKey}
                                        customerId={personDetail.id}
                                        initialLinks={personDetail.companies}
                                        onLinked={handlePersonLinked}
                                    />
                                )}

                                {personTab === "loyalty" && (
                                    <LoyaltyPanel accountId={personDetail.accountId} canManage={canManageLoyalty} />
                                )}

                                {personTab === "quality" && (
                                    <CustomerQualityTab
                                        key={`pq-${personDetail.id}`}
                                        party={{ kind: "person", id: personDetail.id }}
                                        initialNoDiscount={personDetail.noDiscount}
                                        initialQualityLog={personDetail.qualityLog}
                                        canEditCustomer={canEditCustomer}
                                        onSaved={refetchPersonDetail}
                                    />
                                )}

                                {personTab === "outstanding" && (
                                    <PartyOutstandingsPanel
                                        key={`po-${personDetail.accountId}`}
                                        accountId={personDetail.accountId}
                                        partyName={personDetail.name}
                                    />
                                )}

                                {personTab === "transactions" && (
                                    /* The spinner is for having NOTHING to show, never for a
                                       re-read over a statement already on screen (AGENTS.md §7).
                                       Saving a bill-wise link from a row's Status chip used to
                                       throw the whole table out, collapse the page to a 64px
                                       spinner and lose the scroll position — and for nothing: on
                                       a counter that immediate read cannot see the new link yet,
                                       it is the replica's own quiet re-read a moment later that
                                       settles the row. The statement is cleared whenever the
                                       selected party changes, so a different party still gets the
                                       spinner rather than the last party's rows. Same rule as the
                                       Outstanding tab beside it (PartyOutstandingsPanel) and
                                       RecycleBin. */
                                    txLoading && !transactions ? (
                                        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                    ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                    ) : (
                                        <TransactionsTable invVouchers={transactions.invVouchers} accountId={transactions.accountId} onChanged={reloadTransactions} />
                                    )
                                )}
                            </div>
                        </div>
                    )}

                    {selected && !detailLoading && companyDetail && (
                        <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
                            <PartyDetailHeader
                                name={companyDetail.name}
                                phone={companyDetail.phone}
                                address={companyDetail.address}
                                email={companyDetail.email}
                                extra={companyDetail.companyReg ? <span className="text-xs text-muted-foreground">Reg: {companyDetail.companyReg}</span> : null}
                                createdAt={companyDetail.createdAt}
                                socialHref={`/office/social/users/${companyDetail.id}`}
                                chips={[
                                    { key: "contacts", icon: <User size={11} />, text: `${companyDetail.customers.length} contact${companyDetail.customers.length !== 1 ? "s" : ""}` },
                                    { key: "devices", icon: <Smartphone size={11} />, text: `${companyDetail.devices.length} device${companyDetail.devices.length !== 1 ? "s" : ""}` },
                                    { key: "tickets", text: `${companyDetail.devices.flatMap((d) => d.tickets).length} ticket${companyDetail.devices.flatMap((d) => d.tickets).length !== 1 ? "s" : ""}` },
                                ]}
                            />

                            <ModuleTabs
                                module="customers"
                                tabs={["transactions", "outstanding", "profile", "bank", "contacts", "devices", "loyalty", "quality"] as const satisfies readonly CompanyTab[]}
                                active={companyTab}
                                onChange={handleCompanyTabChange}
                            />

                            <div className={`flex-1 overflow-y-auto ${companyTab === "transactions" ? "" : "p-6"}`}>
                                {companyTab === "profile" && (
                                    <CompanyProfileTab
                                        detail={companyDetail}
                                        canEditCompany={canEditCustomer}
                                        canDeleteCompany={canDeleteCustomer}
                                        onSaved={refetchCompanyDetail}
                                        onConverted={(personId) => setSelected({ kind: "person", id: personId })}
                                        onDeleted={handleDeleted}
                                        onReactivated={handleCompanyReactivated}
                                    />
                                )}

                                {companyTab === "bank" && (
                                    <PartyBankTab
                                        key={`bank-c-${companyDetail.id}`}
                                        party={{ kind: "company", id: companyDetail.id, name: companyDetail.name }}
                                        initialBank={companyDetail.bankJson}
                                        canEdit={canEditCustomer}
                                        onSaved={refetchCompanyDetail}
                                    />
                                )}

                                {companyTab === "contacts" && (
                                    <CompanyLinkPanel
                                        key={companyLinkKey}
                                        companyId={companyDetail.id}
                                        initialLinks={companyDetail.customers}
                                        onLinked={handleCompanyLinked}
                                    />
                                )}

                                {companyTab === "devices" && (
                                    companyDetail.devices.length === 0 ? (
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
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {companyDetail.devices.map((device) => {
                                                            const latest = device.tickets[0];
                                                            return (
                                                                <TableRow key={device.id}>
                                                                    <TableCell><span className="text-sm font-medium">{device.brand} {device.model}</span></TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{device.type}</TableCell>
                                                                    <TableCell className="font-mono text-xs text-muted-foreground">{latest ? `#${latest.id}` : "—"}</TableCell>
                                                                    <TableCell>{latest ? <Badge {...badgeColor(latest.ticketStatus.color)}>{latest.ticketStatus.label}</Badge> : "—"}</TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{device.tickets.length}</TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    )
                                )}

                                {companyTab === "loyalty" && (
                                    <LoyaltyPanel accountId={companyDetail.accountId} canManage={canManageLoyalty} />
                                )}

                                {companyTab === "quality" && (
                                    <CustomerQualityTab
                                        key={`cq-${companyDetail.id}`}
                                        party={{ kind: "company", id: companyDetail.id }}
                                        initialNoDiscount={companyDetail.noDiscount}
                                        initialQualityLog={companyDetail.qualityLog}
                                        canEditCustomer={canEditCustomer}
                                        onSaved={refetchCompanyDetail}
                                    />
                                )}

                                {companyTab === "outstanding" && (
                                    <PartyOutstandingsPanel
                                        key={`co-${companyDetail.accountId}`}
                                        accountId={companyDetail.accountId}
                                        partyName={companyDetail.name}
                                    />
                                )}

                                {companyTab === "transactions" && (
                                    /* The spinner is for having NOTHING to show, never for a
                                       re-read over a statement already on screen (AGENTS.md §7).
                                       Saving a bill-wise link from a row's Status chip used to
                                       throw the whole table out, collapse the page to a 64px
                                       spinner and lose the scroll position — and for nothing: on
                                       a counter that immediate read cannot see the new link yet,
                                       it is the replica's own quiet re-read a moment later that
                                       settles the row. The statement is cleared whenever the
                                       selected party changes, so a different party still gets the
                                       spinner rather than the last party's rows. Same rule as the
                                       Outstanding tab beside it (PartyOutstandingsPanel) and
                                       RecycleBin. */
                                    txLoading && !transactions ? (
                                        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                    ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                    ) : (
                                        <TransactionsTable invVouchers={transactions.invVouchers} accountId={transactions.accountId} onChanged={reloadTransactions} />
                                    )
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
