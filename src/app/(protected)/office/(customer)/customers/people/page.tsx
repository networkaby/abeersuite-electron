"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import {
    Search, Plus, User, Phone, MapPin, Building2,
    Smartphone, ExternalLink, Pencil, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
import { PRIORITY_META } from "@/utils/constants";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
interface CustomerListItem {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    _count: { companies: number; devices: number };
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

interface CustomerDetail {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    createdAt: string;
    devices: Device[];
    companies: { id: number; company: { id: number; name: string; phone: string | null } }[];
}

type Tab = "tickets" | "devices" | "companies";

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

export default function CustomersPage() {
    const [customers, setCustomers] = useState<CustomerListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CustomerDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("tickets");

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [saving, setSaving] = useState(false);

    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [editSaving, setEditSaving] = useState(false);

    const loadList = useCallback(async () => {
        try {
            const response = await axios.get<CustomerListItem[]>("/api/people");
            setCustomers(response.data);
        } catch {
            toast.error("Failed to load customers");
        }
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            return;
        }
        setDetailLoading(true);
        axios.get<CustomerDetail>(`/api/people/${selectedId}`)
            .then((response) => {
                setDetail(response.data);
                setTab("tickets");
            })
            .catch(() => toast.error("Failed to load customer"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSaving(true);
        try {
            const response = await axios.post<CustomerListItem>("/api/people", {
                name: form.name,
                phones: form.phone ? [form.phone] : [],
                emails: form.email ? [form.email] : [],
                address: form.address,
            });
            toast.success("Customer created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "" });
            await loadList();
            setSelectedId(response.data.id);
        } catch {
            toast.error("Failed to create customer");
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
        });
        setEditing(true);
    };

    const saveEdit = async () => {
        if (!detail) return;
        setEditSaving(true);
        try {
            await axios.put(`/api/people/${detail.id}`, editForm);
            toast.success("Saved");
            setEditing(false);
            const [listResponse, detailResponse] = await Promise.all([
                axios.get<CustomerListItem[]>("/api/people"),
                axios.get<CustomerDetail>(`/api/people/${detail.id}`),
            ]);
            setCustomers(listResponse.data);
            setDetail(detailResponse.data);
        } catch {
            toast.error("Failed to save");
        } finally {
            setEditSaving(false);
        }
    };

    const filtered = search
        ? customers.filter((customer) =>
            customer.name.toLowerCase().includes(search.toLowerCase()) ||
            (customer.phone ?? "").includes(search)
        )
        : customers;

    const allTickets: (Ticket & { device: Device })[] = detail
        ? detail.devices.flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    return (
        <div className="-m-8 flex h-screen">
            <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <User size={16} className="text-primary" />
                        <span className="text-sm font-semibold">Customers</span>
                        <Badge variant="outline">{customers.length}</Badge>
                    </div>
                    <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus size={13} /> Add
                    </Button>
                </div>

                <div className="border-b p-3">
                    <div className="relative">
                        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name or phone…"
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
                            filtered.map((customer) => (
                                <Button
                                    key={customer.id}
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full justify-start rounded-none border-b px-4 py-3"
                                    onClick={() => setSelectedId(customer.id)}
                                >
                                    <div className="flex w-full items-center gap-3 text-left">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-muted text-xs font-bold">
                                            {initials(customer.name)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{customer.name}</p>
                                            <p className="truncate text-xs text-muted-foreground">{customer.phone || "No phone"}</p>
                                        </div>
                                        {customer._count.devices > 0 && (
                                            <span className="text-xs text-muted-foreground">{customer._count.devices}d</span>
                                        )}
                                    </div>
                                </Button>
                            ))
                        )}
                    </div>
                    <ScrollBar orientation="vertical" />
                </ScrollArea>
            </aside>

            <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
                {!selectedId && (
                    <EmptyState icon={<User size={40} strokeWidth={1} />} message="Select a customer to view activity" />
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
                                                    <Input value={editForm.phone} onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Phone" className="h-8 w-36" />
                                                    <Input value={editForm.address} onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))} placeholder="Address" className="h-8 w-48" />
                                                    <Input value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" className="h-8 w-44" />
                                                </>
                                            ) : (
                                                <>
                                                    {detail.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} />{detail.phone}</span>}
                                                    {detail.address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{detail.address}</span>}
                                                    {detail.email && <span className="text-xs text-muted-foreground">{detail.email}</span>}
                                                    <span className="text-xs text-muted-foreground">Since {formatDate(detail.createdAt)}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {editing ? (
                                        <>
                                            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                                                Cancel
                                            </Button>
                                            <Button type="button" size="sm" onClick={saveEdit} disabled={editSaving}>
                                                {editSaving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button type="button" variant="outline" size="icon-sm" onClick={startEdit} title="Edit customer">
                                                <Pencil size={14} />
                                            </Button>
                                            <Button asChild type="button" variant="outline" size="icon-sm">
                                                <Link href={`/office/customers/${detail.id}`} title="Open full page">
                                                    <ExternalLink size={14} />
                                                </Link>
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="outline"><Smartphone size={11} /> {detail.devices.length} device{detail.devices.length !== 1 ? "s" : ""}</Badge>
                                <Badge variant="outline"><Building2 size={11} /> {detail.companies.length} compan{detail.companies.length !== 1 ? "ies" : "y"}</Badge>
                                <Badge variant="outline">{allTickets.length} ticket{allTickets.length !== 1 ? "s" : ""}</Badge>
                            </div>
                        </div>

                        <div className="border-b bg-card px-6">
                            <div className="flex gap-2 py-2">
                                {(["tickets", "devices", "companies"] as Tab[]).map((item) => (
                                    <Button
                                        key={item}
                                        type="button"
                                        size="sm"
                                        variant={tab === item ? "default" : "ghost"}
                                        onClick={() => setTab(item)}
                                    >
                                        {item}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {tab === "tickets" && (
                                allTickets.length === 0 ? (
                                    <EmptyState icon={<span className="text-3xl">🎫</span>} message="No tickets for this customer yet" />
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
                                                            <TableCell><Badge className={ticket.ticketStatus.color}>{ticket.ticketStatus.label}</Badge></TableCell>
                                                            <TableCell><Badge className={PRIORITY_META[ticket.priority]?.color ?? ""}>{PRIORITY_META[ticket.priority]?.label ?? ticket.priority}</Badge></TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                                                            <TableCell className="text-right">
                                                                {/* <Button asChild variant="link" size="sm">
                                                                    <Link href={`/office/repairing/tickets/${ticket.id}`}>View</Link>
                                                                </Button> //breaking*/}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </CardContent>
                                    </Card>
                                )
                            )}

                            {tab === "devices" && (
                                detail.devices.length === 0 ? (
                                    <EmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered yet" />
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

                            {tab === "companies" && (
                                detail.companies.length === 0 ? (
                                    <EmptyState icon={<span className="text-3xl">🏢</span>} message="Not linked to any company" />
                                ) : (
                                    <div className="space-y-2">
                                        {detail.companies.map((companyLink) => (
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
                                                    <Button asChild variant="link" size="sm">
                                                        <Link href={`/office/customers/companies/${companyLink.company.id}`}>View</Link>
                                                    </Button>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                )
                            )}
                        </div>
                    </>
                )}
            </section>

            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Customer</DialogTitle>
                        <DialogDescription>Add a customer record for future tickets and device history.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-3">
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
