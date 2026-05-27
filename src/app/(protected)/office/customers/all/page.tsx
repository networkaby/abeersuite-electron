"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import {
    ArrowLeft,
    Building2,
    ExternalLink,
    Loader2,
    MapPin,
    Phone,
    Smartphone,
    User,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { formatDate } from "@/shared/lib/format/formatDate";
import { PRIORITY_META } from "@/utils/constants";
import { initials } from "@/modules/customer/lib/initials";
import type { Ticket, CustomerDevice } from "@/modules/customer/lib/customerTypes";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import DevicesMiniGrid from "@/modules/customer/components/DevicesMiniGrid";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { TransactionsTable, type CustomerTransactions } from "@/modules/customer/components/TransactionsTable";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
import CustomerEmergencyPasswordResetCard from "@/modules/customer/components/CustomerEmergencyPasswordResetCard";
import PersonProfileEdit from "@/modules/customer/components/PersonProfileEdit";
import CompanyProfileEdit from "@/modules/customer/components/CompanyProfileEdit";

type PersonRow = {
    id: number;
    name: string;
    phone: string | null;
    account: { id: number } | null;
};

type CompanyRow = {
    id: number;
    name: string;
    phone: string | null;
    account: { id: number } | null;
};

type CombinedListItem =
    | { kind: "person"; id: number; name: string; phone: string | null; accountId: number | null }
    | { kind: "company"; id: number; name: string; phone: string | null; accountId: number | null };

type PersonDetail = {
    id: number;
    accountId: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    createdAt: string;
    devices: CustomerDevice[];
    companies: { id: number; company: { id: number; name: string; phone: string | null; accountId: number } }[];
    phones: { id: number; phone: string; label: string | null; isPrimary: boolean }[];
    emails: { id: number; email: string; label: string | null; isPrimary: boolean }[];
};

type CompanyDetail = {
    id: number;
    accountId: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
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
type PersonTab = "transactions" | "profile" | "tickets" | "devices" | "companies";
type CompanyTab = "transactions" | "profile" | "contacts" | "devices";


export default function AllCustomersPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const [people, setPeople] = useState<PersonRow[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
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

    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManageUsers = perms.includes(PERMISSIONS.USERS_MANAGE) || perms.includes(PERMISSIONS.ADMIN_BYPASS);

    useEffect(() => {
        axios.get<PersonRow[]>("/api/person").then((res) => setPeople(res.data)).catch(() => setPeople([]));
        axios.get<CompanyRow[]>("/api/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
    }, []);

    // Pre-select a row from URL query params on mount.  Day Book / register
    // tables link here as /office/customers/all?personId=<id> or ?companyId=<id>
    // so clicking a party in those views opens the same 3-column layout with
    // the right customer already selected.
    const searchParams = useSearchParams();
    useEffect(() => {
        const personId  = searchParams.get("personId");
        const companyId = searchParams.get("companyId");
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (personId)  setSelected({ kind: "person",  id: Number(personId) });
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

    useEffect(() => {
        if (!selected) return;
        const wantsTransactions =
            (selected.kind === "person" && personTab === "transactions")
            || (selected.kind === "company" && companyTab === "transactions");
        if (!wantsTransactions || transactions) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTxLoading(true);
        const url =
            selected.kind === "person"
                ? `/api/person/${selected.id}/transactions`
                : `/api/companies/${selected.id}/transactions`;

        axios
            .get<CustomerTransactions>(url)
            .then((r) => setTransactions(r.data))
            .catch(() => {})
            .finally(() => setTxLoading(false));
    }, [selected, personTab, companyTab, transactions]);

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
            .catch(() => {});
    }, [selected]);

    const handleCompanyLinked = useCallback(() => {
        if (!selected || selected.kind !== "company") return;
        setCompanyLinkKey(k => k + 1);
        axios.get<CompanyDetail>(`/api/companies/${selected.id}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => {});
    }, [selected]);

    const refetchPersonDetail = useCallback(() => {
        if (!selected || selected.kind !== "person") return;
        axios.get<PersonDetail>(`/api/person/${selected.id}`)
            .then((res) => setPersonDetail(res.data))
            .catch(() => {});
    }, [selected]);

    const refetchCompanyDetail = useCallback(() => {
        if (!selected || selected.kind !== "company") return;
        axios.get<CompanyDetail>(`/api/companies/${selected.id}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => {});
    }, [selected]);

    const merged = useMemo<CombinedListItem[]>(
        () => [
            ...people.map((p) => ({ kind: "person" as const, id: p.id, name: p.name, phone: p.phone, accountId: p.account?.id ?? null })),
            ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, phone: c.phone, accountId: c.account?.id ?? null })),
        ],
        [people, companies]
    );

    const filtered = useMemo(
        () =>
            search.trim()
                ? merged.filter(
                    (item) =>
                        item.name.toLowerCase().includes(search.toLowerCase()) ||
                        (item.phone ?? "").includes(search)
                )
                : merged,
        [merged, search]
    );

    const personTickets: (Ticket & { device: CustomerDevice })[] = personDetail
        ? personDetail.devices
            .flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
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
            </header>
            <div className="flex flex-1 overflow-hidden">
            <EntityListPanel
                title="All Customers"
                icon={<User size={15} className="text-primary" />}
                count={people.length + companies.length}
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search name or phone…"
                isEmpty={filtered.length === 0}
                emptyMessage={search ? "No matches" : "No customers yet"}
            >
                {filtered.map((item) => {
                    const Icon = item.kind === "person" ? User : Building2;
                    const isActive = selected?.kind === item.kind && selected.id === item.id;
                    return (
                        <Button
                            key={`${item.kind}-${item.id}`}
                            asChild
                            variant="ghost"
                            className={`h-auto w-full justify-start rounded-none border-b px-4 py-3 ${isActive ? "bg-muted" : ""}`}
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
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-muted text-xs font-bold">
                                        {initials(item.name)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{item.name}</p>
                                        <p className="truncate text-xs text-muted-foreground">{item.phone || "No phone"}</p>
                                    </div>
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

            <section className="flex flex-1 bg-muted/30">
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
                        <div className="border-b bg-card px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-bold text-primary-foreground">
                                        {initials(personDetail.name)}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold">{personDetail.name}</h2>
                                        <div className="mt-1 flex flex-wrap items-center gap-3">
                                            {personDetail.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} />{personDetail.phone}</span>}
                                            {personDetail.address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{personDetail.address}</span>}
                                            {personDetail.email && <span className="text-xs text-muted-foreground">{personDetail.email}</span>}
                                            <span className="text-xs text-muted-foreground">Since {formatDate(personDetail.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <Button asChild type="button" variant="outline" size="icon-sm">
                                    <Link href={`/office/social/users/${personDetail.id}`} title="Social profile">
                                        <ExternalLink size={14} />
                                    </Link>
                                </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="outline"><Smartphone size={11} /> {personDetail.devices.length} device{personDetail.devices.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline"><Building2 size={11} /> {personDetail.companies.length} compan{personDetail.companies.length !== 1 ? "ies" : "y"}</Badge>
                                <Badge variant="outline">{personTickets.length} ticket{personTickets.length !== 1 ? "s" : ""}</Badge>
                            </div>
                        </div>

                        <div className="border-b bg-card px-6">
                            <div className="flex gap-2 py-2">
                                {(["transactions", "profile", "tickets", "devices", "companies"] as PersonTab[]).map((item) => (
                                    <Button key={item} type="button" size="sm" variant={personTab === item ? "default" : "ghost"} onClick={() => handlePersonTabChange(item)}>
                                        {item}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className={`flex-1 overflow-y-auto ${personTab === "transactions" ? "" : "p-6"}`}>
                            {personTab === "profile" && (
                                <div className="space-y-6">
                                    <PersonProfileEdit
                                        key={selected?.id}
                                        profile={{
                                            id: personDetail.id,
                                            name: personDetail.name,
                                            address: personDetail.address,
                                            phones: personDetail.phones ?? [],
                                            emails: personDetail.emails ?? [],
                                        }}
                                        onSaved={refetchPersonDetail}
                                    />
                                    <DevicesMiniGrid devices={personDetail.devices} />
                                    {canManageUsers && (
                                        <CustomerEmergencyPasswordResetCard customerId={personDetail.id} />
                                    )}
                                </div>
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
                                                            <TableCell><Badge className={ticket.ticketStatus.color}>{ticket.ticketStatus.label}</Badge></TableCell>
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

                            {personTab === "transactions" && (
                                txLoading ? (
                                    <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                    <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                ) : (
                                    <TransactionsTable invVouchers={transactions.invVouchers} />
                                )
                            )}
                        </div>
                    </div>
                )}

                {selected && !detailLoading && companyDetail && (
                    <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
                        <div className="border-b bg-card px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-bold text-primary-foreground">
                                        {initials(companyDetail.name)}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold">{companyDetail.name}</h2>
                                        <div className="mt-1 flex flex-wrap items-center gap-3">
                                            {companyDetail.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} />{companyDetail.phone}</span>}
                                            {companyDetail.address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{companyDetail.address}</span>}
                                            {companyDetail.email && <span className="text-xs text-muted-foreground">{companyDetail.email}</span>}
                                            {companyDetail.companyReg && <span className="text-xs text-muted-foreground">Reg: {companyDetail.companyReg}</span>}
                                            <span className="text-xs text-muted-foreground">Since {formatDate(companyDetail.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <Button asChild type="button" variant="outline" size="icon-sm">
                                    <Link href={`/office/social/users/${companyDetail.id}`} title="Social profile">
                                        <ExternalLink size={14} />
                                    </Link>
                                </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="outline"><User size={11} /> {companyDetail.customers.length} contact{companyDetail.customers.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline"><Smartphone size={11} /> {companyDetail.devices.length} device{companyDetail.devices.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline">{companyDetail.devices.flatMap((d) => d.tickets).length} ticket{companyDetail.devices.flatMap((d) => d.tickets).length !== 1 ? "s" : ""}</Badge>
                            </div>
                        </div>

                        <div className="border-b bg-card px-6">
                            <div className="flex gap-2 py-2">
                                {(["transactions", "profile", "contacts", "devices"] as CompanyTab[]).map((item) => (
                                    <Button key={item} type="button" size="sm" variant={companyTab === item ? "default" : "ghost"} onClick={() => handleCompanyTabChange(item)}>
                                        {item}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className={`flex-1 overflow-y-auto ${companyTab === "transactions" ? "" : "p-6"}`}>
                            {companyTab === "profile" && (
                                <div className="space-y-6">
                                    <CompanyProfileEdit
                                        key={selected?.id}
                                        profile={{
                                            id: companyDetail.id,
                                            name: companyDetail.name,
                                            address: companyDetail.address,
                                            companyReg: companyDetail.companyReg,
                                            taxId: companyDetail.taxId,
                                            phones: companyDetail.contactRows?.phones ?? [],
                                            emails: companyDetail.contactRows?.emails ?? [],
                                        }}
                                        onSaved={refetchCompanyDetail}
                                    />
                                    <DevicesMiniGrid devices={companyDetail.devices} />
                                </div>
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
                                                                <TableCell>{latest ? <Badge className={latest.ticketStatus.color}>{latest.ticketStatus.label}</Badge> : "—"}</TableCell>
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

                            {companyTab === "transactions" && (
                                txLoading ? (
                                    <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                    <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                ) : (
                                    <TransactionsTable invVouchers={transactions.invVouchers} />
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
