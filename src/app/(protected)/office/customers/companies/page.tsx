"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import {
    Building2, Phone, MapPin,
    User, Smartphone, ExternalLink, Pencil, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
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

interface CompanyListItem {
    id: number;
    name: string;
    phone: string | null;
    companyReg: string | null;
    _count: { customers: number; devices: number };
}

interface Ticket {
    id: number;
    priority: string;
    createdAt: string;
    ticketStatus: { label: string; color: string };
}

interface Device {
    id: number;
    brand: string;
    model: string;
    type: string;
    tickets: Ticket[];
}

interface CompanyDetail {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    companyReg: string | null;
    taxId: string | null;
    createdAt: string;
    devices: Device[];
    customers: { id: number; customer: { id: number; name: string; phone: string | null } }[];
}

type Tab = "contacts" | "devices" | "transactions";

function initials(name: string) {
    return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <div className="mb-3">{icon}</div>
            <p className="text-sm">{message}</p>
        </div>
    );
}

export default function CompaniesPage() {
    const [companies, setCompanies] = useState<CompanyListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("contacts");
    const [transactions, setTransactions] = useState<CustomerTransactions | null>(null);
    const [txLoading, setTxLoading] = useState(false);

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [saving, setSaving] = useState(false);

    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [editSaving, setEditSaving] = useState(false);

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
                setTab("contacts");
            })
            .catch(() => toast.error("Failed to load company"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    const handleTabChange = (next: Tab) => {
        setTab(next);
        if (next === "transactions" && !transactions && selectedId) {
            setTxLoading(true);
            axios.get<CustomerTransactions>(`/api/companies/${selectedId}/transactions`)
                .then((r) => setTransactions(r.data))
                .catch(() => toast.error("Failed to load transactions"))
                .finally(() => setTxLoading(false));
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error("Company name is required");
            return;
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

    const startEdit = () => {
        if (!detail) return;
        setEditForm({
            name: detail.name,
            phone: detail.phone ?? "",
            email: detail.email ?? "",
            address: detail.address ?? "",
            companyReg: detail.companyReg ?? "",
            taxId: detail.taxId ?? "",
        });
        setEditing(true);
    };

    const saveEdit = async () => {
        if (!detail) return;
        setEditSaving(true);
        try {
            await axios.put(`/api/companies/${detail.id}`, editForm);
            toast.success("Saved");
            setEditing(false);
            const [listResponse, detailResponse] = await Promise.all([
                axios.get<CompanyListItem[]>("/api/companies"),
                axios.get<CompanyDetail>(`/api/companies/${detail.id}`),
            ]);
            setCompanies(listResponse.data);
            setDetail(detailResponse.data);
        } catch {
            toast.error("Failed to save");
        } finally {
            setEditSaving(false);
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
        <div className="-m-8 flex h-screen overflow-hidden bg-card">
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
                    <EmptyState icon={<Building2 size={40} strokeWidth={1} />} message="Select a company to view details" />
                )}

                {selectedId && detailLoading && (
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                )}

                {selectedId && !detailLoading && detail && (
                    <>
                        <div className="border-b bg-card px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-bold text-primary-foreground">
                                        {initials(detail.name)}
                                    </div>
                                    <div>
                                        {editing ? (
                                            <Input
                                                value={editForm.name}
                                                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                                className="h-9 w-64 text-base font-semibold"
                                                autoFocus
                                            />
                                        ) : (
                                            <h2 className="text-xl font-bold">{detail.name}</h2>
                                        )}
                                        <div className="mt-1 flex flex-wrap items-center gap-3">
                                            {editing ? (
                                                <>
                                                    <Input value={editForm.phone} onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Phone" className="h-8 w-32" />
                                                    <Input value={editForm.address} onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))} placeholder="Address" className="h-8 w-44" />
                                                    <Input value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" className="h-8 w-40" />
                                                    <Input value={editForm.companyReg} onChange={(e) => setEditForm((prev) => ({ ...prev, companyReg: e.target.value }))} placeholder="Company Reg" className="h-8 w-32" />
                                                    <Input value={editForm.taxId} onChange={(e) => setEditForm((prev) => ({ ...prev, taxId: e.target.value }))} placeholder="Tax / VAT" className="h-8 w-28" />
                                                </>
                                            ) : (
                                                <>
                                                    {detail.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} />{detail.phone}</span>}
                                                    {detail.address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{detail.address}</span>}
                                                    {detail.email && <span className="text-xs text-muted-foreground">{detail.email}</span>}
                                                    {detail.companyReg && <span className="text-xs text-muted-foreground">Reg: {detail.companyReg}</span>}
                                                    <span className="text-xs text-muted-foreground">Since {formatDate(detail.createdAt)}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {editing ? (
                                        <>
                                            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                                            <Button type="button" size="sm" onClick={saveEdit} disabled={editSaving}>
                                                {editSaving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button type="button" variant="outline" size="icon-sm" onClick={startEdit}>
                                                <Pencil size={14} />
                                            </Button>
                                            <Button asChild type="button" variant="outline" size="icon-sm">
                                                <Link href={`/office/customers/companies/${detail.id}`}>
                                                    <ExternalLink size={14} />
                                                </Link>
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="outline"><User size={11} /> {detail.customers.length} contact{detail.customers.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline"><Smartphone size={11} /> {detail.devices.length} device{detail.devices.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline">{detail.devices.flatMap((d) => d.tickets).length} ticket{detail.devices.flatMap((d) => d.tickets).length !== 1 ? "s" : ""}</Badge>
                            </div>
                        </div>

                        <div className="border-b bg-card px-6">
                            <div className="flex gap-2 py-2">
                                {(["contacts", "devices", "transactions"] as Tab[]).map((item) => (
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

                        <div className="flex-1 overflow-y-auto p-6">
                            {tab === "contacts" && (
                                detail.customers.length === 0 ? (
                                    <EmptyState icon={<span className="text-3xl">👤</span>} message="No contacts linked to this company" />
                                ) : (
                                    <div className="space-y-2">
                                        {detail.customers.map((companyContact) => (
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

                            {tab === "devices" && (
                                detail.devices.length === 0 ? (
                                    <EmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered to this company" />
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

                            {tab === "transactions" && (
                                txLoading ? (
                                    <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                                ) : !transactions ? null : (transactions.invoices.length === 0 && transactions.invVouchers.length === 0) ? (
                                    <EmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                                ) : (
                                    <TransactionsTable invoices={transactions.invoices} invVouchers={transactions.invVouchers} />
                                )
                            )}
                        </div>
                    </>
                )}
            </section>

            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Company</DialogTitle>
                        <DialogDescription>Create a company record with optional registration and tax details.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-3">
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
