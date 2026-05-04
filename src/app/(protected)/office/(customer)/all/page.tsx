"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
    Building2,
    ExternalLink,
    Loader2,
    MapPin,
    Phone,
    Search,
    Smartphone,
    User,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { PRIORITY_META } from "@/utils/constants";
import { ScrollArea } from "@/components/ui/scroll-area";

type PersonRow = {
    id: number;
    name: string;
    phone: string | null;
};

type CompanyRow = {
    id: number;
    name: string;
    phone: string | null;
};

type CombinedListItem =
    | { kind: "person"; id: number; name: string; phone: string | null }
    | { kind: "company"; id: number; name: string; phone: string | null };

type PersonDetail = {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    createdAt: string;
    devices: PersonDevice[];
    companies: { id: number; company: { id: number; name: string; phone: string | null } }[];
};

type CompanyDetail = {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    companyReg: string | null;
    taxId: string | null;
    createdAt: string;
    devices: CompanyDevice[];
    customers: { id: number; customer: { id: number; name: string; phone: string | null } }[];
};

type SelectedItem = { kind: "person" | "company"; id: number };
type PersonTab = "tickets" | "devices" | "companies";
type CompanyTab = "contacts" | "devices";

type Ticket = {
    id: number;
    priority: string;
    createdAt: string;
    ticketStatus: { label: string; color: string };
};

type PersonDevice = {
    id: number;
    brand: string;
    model: string;
    type: string;
    tickets: Ticket[];
};

type CompanyDevice = {
    id: number;
    brand: string;
    model: string;
    type: string;
    tickets: Ticket[];
};

function initials(name: string) {
    return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

export default function AllCustomersPage() {
    const [people, setPeople] = useState<PersonRow[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<SelectedItem | null>(null);
    const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
    const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [personTab, setPersonTab] = useState<PersonTab>("tickets");
    const [companyTab, setCompanyTab] = useState<CompanyTab>("contacts");

    useEffect(() => {
        axios.get<PersonRow[]>("/api/customers").then((res) => setPeople(res.data)).catch(() => setPeople([]));
        axios.get<CompanyRow[]>("/api/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
    }, []);

    useEffect(() => {
        if (!selected) {
            const id = window.setTimeout(() => {
                setPersonDetail(null);
                setCompanyDetail(null);
                setDetailLoading(false);
            }, 0);
            return () => window.clearTimeout(id);
        }

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setDetailLoading(true);
            const finishLoading = () => {
                if (!cancelled) setDetailLoading(false);
            };

            if (selected.kind === "person") {
                axios
                    .get<PersonDetail>(`/api/customers/${selected.id}`)
                    .then((res) => {
                        if (cancelled) return;
                        setPersonDetail(res.data);
                        setCompanyDetail(null);
                        setPersonTab("tickets");
                    })
                    .catch(() => {
                        if (cancelled) return;
                        setPersonDetail(null);
                        setCompanyDetail(null);
                    })
                    .finally(finishLoading);
                return;
            }

            axios
                .get<CompanyDetail>(`/api/companies/${selected.id}`)
                .then((res) => {
                    if (cancelled) return;
                    setCompanyDetail(res.data);
                    setPersonDetail(null);
                    setCompanyTab("contacts");
                })
                .catch(() => {
                    if (cancelled) return;
                    setCompanyDetail(null);
                    setPersonDetail(null);
                })
                .finally(finishLoading);
        });

        return () => {
            cancelled = true;
        };
    }, [selected]);

    const merged = useMemo<CombinedListItem[]>(
        () => [
            ...people.map((person) => ({ kind: "person" as const, id: person.id, name: person.name, phone: person.phone })),
            ...companies.map((company) => ({ kind: "company" as const, id: company.id, name: company.name, phone: company.phone })),
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

    const personTickets: (Ticket & { device: PersonDevice })[] = personDetail
        ? personDetail.devices
            .flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    return (
        <div className="-m-8 flex h-screen">
            <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <User size={16} className="text-primary" />
                        <span className="text-sm font-semibold">All Customers</span>
                        <Badge variant="outline">{people.length} + {companies.length} = {people.length + companies.length}</Badge>
                    </div>
                </div>

                <div className="border-b p-3">
                    <div className="relative">
                        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name or phone..."
                            className="pl-9"
                        />
                    </div>
                </div>

                < ScrollArea className="flex-1 overflow-y-auto">
                    <div className="flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <p className="py-8 text-center text-xs text-muted-foreground">
                                {search ? "No matches" : "No customers yet"}
                            </p>
                        ) : (
                            filtered.map((item) => {
                                const Icon = item.kind === "person" ? User : Building2;
                                const isActive = selected?.kind === item.kind && selected.id === item.id;
                                return (
                                    <Button
                                        key={`${item.kind}-${item.id}`}
                                        type="button"
                                        variant="ghost"
                                        className={`h-auto w-full justify-start rounded-none border-b px-4 py-3 ${isActive ? "bg-muted" : ""}`}
                                        onClick={() => setSelected({ kind: item.kind, id: item.id })}
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
                                    </Button>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>
            </aside>

            <section className="flex flex-1 bg-muted/30 p-6">
                {!selected && (
                    <div className="m-auto text-sm text-muted-foreground">
                        Select a person or company from the list to open details.
                    </div>
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
                                    <Link href={`/office/customers/${personDetail.id}`} title="Open full page">
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
                                {(["tickets", "devices", "companies"] as PersonTab[]).map((item) => (
                                    <Button key={item} type="button" size="sm" variant={personTab === item ? "default" : "ghost"} onClick={() => setPersonTab(item)}>
                                        {item}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {personTab === "tickets" && (
                                personTickets.length === 0 ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">No tickets for this customer yet</div>
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
                                    <div className="py-10 text-center text-sm text-muted-foreground">No devices registered yet</div>
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
                                personDetail.companies.length === 0 ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">Not linked to any company</div>
                                ) : (
                                    <div className="space-y-2">
                                        {personDetail.companies.map((companyLink) => (
                                            <Card key={companyLink.id}>
                                                <CardContent className="flex items-center justify-between pt-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                                            <Building2 size={14} className="text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium">{companyLink.company.name}</p>
                                                            {companyLink.company.phone && <p className="text-xs text-muted-foreground">{companyLink.company.phone}</p>}
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
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
                                    <Link href={`/office/companies/${companyDetail.id}`}>
                                        <ExternalLink size={14} />
                                    </Link>
                                </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="outline"><User size={11} /> {companyDetail.customers.length} contact{companyDetail.customers.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline"><Smartphone size={11} /> {companyDetail.devices.length} device{companyDetail.devices.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline">{companyDetail.devices.flatMap((device) => device.tickets).length} ticket{companyDetail.devices.flatMap((device) => device.tickets).length !== 1 ? "s" : ""}</Badge>
                            </div>
                        </div>

                        <div className="border-b bg-card px-6">
                            <div className="flex gap-2 py-2">
                                {(["contacts", "devices"] as CompanyTab[]).map((item) => (
                                    <Button key={item} type="button" size="sm" variant={companyTab === item ? "default" : "ghost"} onClick={() => setCompanyTab(item)}>
                                        {item}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {companyTab === "contacts" && (
                                companyDetail.customers.length === 0 ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">No contacts linked to this company</div>
                                ) : (
                                    <div className="space-y-2">
                                        {companyDetail.customers.map((companyContact) => (
                                            <Card key={companyContact.id}>
                                                <CardContent className="flex items-center justify-between pt-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-none bg-muted">
                                                            <User size={14} className="text-muted-foreground" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium">{companyContact.customer.name}</p>
                                                            {companyContact.customer.phone && <p className="text-xs text-muted-foreground">{companyContact.customer.phone}</p>}
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                )
                            )}

                            {companyTab === "devices" && (
                                companyDetail.devices.length === 0 ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">No devices registered to this company</div>
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
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
