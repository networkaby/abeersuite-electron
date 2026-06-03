"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Building2, Phone, MapPin,
    User, Smartphone, ExternalLink, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { initials } from "@/modules/customer/lib/initials";
import { phoneError, emailError } from "@/shared/components/PartySearchAndCreate";
import type { CustomerDevice } from "@/modules/customer/lib/customerTypes";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import DevicesMiniGrid from "@/modules/customer/components/DevicesMiniGrid";
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
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
import CompanyProfileEdit from "@/modules/customer/components/CompanyProfileEdit";
import AccountCreditLimitCard from "@/modules/customer/components/AccountCreditLimitCard";
import { LoyaltyPanel } from "@/modules/loyalty/components/LoyaltyPanel";

interface CompanyListItem {
    id: number;
    name: string;
    phone: string | null;
    companyReg: string | null;
    _count: { customers: number; devices: number };
}

interface CompanyDetail {
    id: number;
    accountId: number;
    creditLimit: string | null;
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
}

type Tab = "transactions" | "profile" | "contacts" | "devices" | "loyalty";

export default function CompaniesPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManageLoyalty = perms.includes(PERMISSIONS.LOYALTY_MANAGE) || perms.includes(PERMISSIONS.ADMIN_BYPASS);
    const canEditCompany = perms.includes(PERMISSIONS.COMPANIES_EDIT_ORG) || perms.includes(PERMISSIONS.ADMIN_BYPASS);
    const [companies, setCompanies] = useState<CompanyListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("transactions");
    const [transactions, setTransactions] = useState<CustomerTransactions | null>(null);
    const [txLoading, setTxLoading] = useState(false);
    const [linkKey, setLinkKey] = useState(0);

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [saving, setSaving] = useState(false);

    const loadList = useCallback(async () => {
        try {
            const response = await axios.get<CompanyListItem[]>("/api/companies");
            setCompanies(response.data);
        } catch {
            toast.error("Failed to load companies");
        }
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

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

    // Auto-load transactions when tab is active (covers default + manual switch).
    useEffect(() => {
        if (!selectedId || tab !== "transactions" || transactions) return;
        setTxLoading(true);
        axios.get<CustomerTransactions>(`/api/companies/${selectedId}/transactions`)
            .then((r) => setTransactions(r.data))
            .catch(() => {})
            .finally(() => setTxLoading(false));
    }, [selectedId, tab, transactions]);

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

    // Re-fetch after profile edits saved (CompanyProfileEdit).
    const refetchDetail = useCallback(() => {
        if (!selectedId) return;
        axios.get<CompanyDetail>(`/api/companies/${selectedId}`)
            .then((res) => {
                setDetail(res.data);
                // Also refresh the list item name in sidebar
                setCompanies(prev => prev.map(c => c.id === selectedId && res.data ? { ...c, name: res.data.name } : c));
            })
            .catch(() => {});
    }, [selectedId]);

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
            await loadList();
            setSelectedId(response.data.id);
        } catch {
            toast.error("Failed to create company");
        } finally {
            setSaving(false);
        }
    };

    const filtered = search
        ? companies.filter((company) =>
            company.name.toLowerCase().includes(search.toLowerCase()) ||
            (company.phone ?? "").includes(search) ||
            (company.companyReg ?? "").toLowerCase().includes(search.toLowerCase())
        )
        : companies;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Link href="/office/customers" className="transition-colors hover:text-foreground">Customers</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">Companies</span>
                </nav>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Companies"
                    icon={<Building2 size={16} className="text-primary" />}
                    count={companies.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search name, phone, reg…"
                    onAdd={() => setShowCreate(true)}
                    isEmpty={filtered.length === 0}
                    emptyMessage={search ? "No matches" : "No companies yet"}
                >
                    {filtered.map((company) => (
                        <Button
                            key={company.id}
                            type="button"
                            variant="ghost"
                            className={`h-auto w-full justify-start rounded-none border-b px-4 py-3 ${selectedId === company.id ? "bg-muted" : ""}`}
                            onClick={() => setSelectedId(company.id)}
                        >
                            <div className="flex w-full items-center gap-3 text-left">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-muted text-xs font-bold">
                                    {initials(company.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{company.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">{company.phone || "No phone"}</p>
                                </div>
                                {company._count.customers > 0 && (
                                    <span className="text-xs text-muted-foreground">{company._count.customers}c</span>
                                )}
                            </div>
                        </Button>
                    ))}
                </EntityListPanel>

                <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
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
                            <div className="border-b bg-card px-6 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-bold text-primary-foreground">
                                            {initials(detail.name)}
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-bold">{detail.name}</h2>
                                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                                {detail.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} />{detail.phone}</span>}
                                                {detail.address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{detail.address}</span>}
                                                {detail.email && <span className="text-xs text-muted-foreground">{detail.email}</span>}
                                                {detail.companyReg && <span className="text-xs text-muted-foreground">Reg: {detail.companyReg}</span>}
                                                <span className="text-xs text-muted-foreground">Since {formatDate(detail.createdAt)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <Button asChild type="button" variant="outline" size="icon-sm">
                                        <Link href={`/office/social/users/${detail.id}`} title="Social profile">
                                            <ExternalLink size={14} />
                                        </Link>
                                    </Button>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Badge variant="outline"><User size={11} /> {detail.customers.length} contact{detail.customers.length !== 1 ? "s" : ""}</Badge>
                                    <Badge variant="outline"><Smartphone size={11} /> {detail.devices.length} device{detail.devices.length !== 1 ? "s" : ""}</Badge>
                                    <Badge variant="outline">{detail.devices.flatMap((d) => d.tickets).length} ticket{detail.devices.flatMap((d) => d.tickets).length !== 1 ? "s" : ""}</Badge>
                                </div>
                            </div>

                            {/* ── Tabs ── */}
                            <div className="border-b bg-card px-6">
                                <div className="flex gap-2 py-2">
                                    {(["transactions", "profile", "contacts", "devices", "loyalty"] as Tab[]).map((item) => (
                                        <Button
                                            key={item}
                                            type="button"
                                            size="sm"
                                            variant={tab === item ? "default" : "ghost"}
                                            onClick={() => handleTabChange(item)}
                                        >
                                            {item}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            {/* ── Tab content ── */}
                            <div className={`flex-1 overflow-y-auto ${tab === "transactions" ? "" : "p-6"}`}>

                                {/* Profile — inline editing */}
                                {tab === "profile" && (
                                    <div className="space-y-6">
                                        <CompanyProfileEdit
                                            key={selectedId}
                                            profile={{
                                                id: detail.id,
                                                name: detail.name,
                                                address: detail.address,
                                                companyReg: detail.companyReg,
                                                taxId: detail.taxId,
                                                phones: detail.contactRows?.phones ?? [],
                                                emails: detail.contactRows?.emails ?? [],
                                            }}
                                            onSaved={refetchDetail}
                                        />
                                        <AccountCreditLimitCard
                                            key={`cl-${selectedId}`}
                                            accountId={detail.accountId}
                                            initialLimit={detail.creditLimit}
                                            canEdit={canEditCompany}
                                            onSaved={refetchDetail}
                                        />
                                        <DevicesMiniGrid devices={detail.devices} />
                                    </div>
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
                                                                    <TableCell>{latest ? <Badge className={latest.ticketStatus.color}>{latest.ticketStatus.label}</Badge> : "—"}</TableCell>
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

                                {/* Transactions */}
                                {tab === "transactions" && (
                                    txLoading ? (
                                        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                    ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                        <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                    ) : (
                                        <TransactionsTable invVouchers={transactions.invVouchers} />
                                    )
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
