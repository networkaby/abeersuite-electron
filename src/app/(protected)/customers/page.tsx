"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import {
    Search, Plus, User, Phone, MapPin, Building2,
    Smartphone, ExternalLink, Pencil, X, Check, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomerListItem {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    _count: { companies: number; devices: number };
}

interface Ticket {
    id: number;
    createdAt: string;
    ticketStatus: { label: string; color: string };
    ticketPriority: { label: string; color: string };
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomersPage() {
    const [customers, setCustomers] = useState<CustomerListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CustomerDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("tickets");

    // create
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [saving, setSaving] = useState(false);

    // inline edit
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [editSaving, setEditSaving] = useState(false);

    // ── Load list ──────────────────────────────────────────────────────────────

    const loadList = useCallback(async () => {
        try {
            const res = await axios.get<CustomerListItem[]>("/api/customers");
            setCustomers(res.data);
        } catch {
            toast.error("Failed to load customers");
        }
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    // ── Load detail ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!selectedId) { setDetail(null); return; }
        setDetailLoading(true);
        axios.get<CustomerDetail>(`/api/customers/${selectedId}`)
            .then(r => { setDetail(r.data); setTab("tickets"); })
            .catch(() => toast.error("Failed to load customer"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    // ── Create ─────────────────────────────────────────────────────────────────

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            const res = await axios.post<CustomerListItem>("/api/customers", form);
            toast.success("Customer created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "" });
            await loadList();
            setSelectedId(res.data.id);
        } catch {
            toast.error("Failed to create customer");
        } finally {
            setSaving(false);
        }
    };

    // ── Inline edit ────────────────────────────────────────────────────────────

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
            await axios.put(`/api/customers/${detail.id}`, editForm);
            toast.success("Saved");
            setEditing(false);
            // refresh both
            const [listRes, detailRes] = await Promise.all([
                axios.get<CustomerListItem[]>("/api/customers"),
                axios.get<CustomerDetail>(`/api/customers/${detail.id}`),
            ]);
            setCustomers(listRes.data);
            setDetail(detailRes.data);
        } catch {
            toast.error("Failed to save");
        } finally {
            setEditSaving(false);
        }
    };

    // ── Derived ────────────────────────────────────────────────────────────────

    const filtered = search
        ? customers.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone ?? "").includes(search)
        )
        : customers;

    const allTickets: (Ticket & { device: Device })[] = detail
        ? detail.devices.flatMap(d => d.tickets.map(t => ({ ...t, device: d })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        // -m-8 cancels the p-8 from ProtectedLayout so panels fill edge-to-edge
        <div className="-m-8 flex" style={{ height: "100vh" }}>

            {/* ── LEFT: Customer list ──────────────────────────────────────────── */}
            <div className="w-72 flex flex-col border-r bg-white shrink-0">

                {/* header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div className="flex items-center gap-2">
                        <User size={16} className="text-blue-600" />
                        <span className="font-semibold text-sm">Customers</span>
                        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{customers.length}</span>
                    </div>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700"
                    >
                        <Plus size={13} /> Add
                    </button>
                </div>

                {/* search */}
                <div className="px-3 py-2 border-b">
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search name or phone…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* list */}
                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-8">
                            {search ? "No matches" : "No customers yet"}
                        </p>
                    ) : (
                        filtered.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-50 transition-colors ${selectedId === c.id
                                    ? "bg-blue-50 border-l-2 border-l-blue-600"
                                    : "hover:bg-gray-50 border-l-2 border-l-transparent"
                                    }`}
                            >
                                {/* avatar */}
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${selectedId === c.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                                    {initials(c.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm font-medium truncate ${selectedId === c.id ? "text-blue-700" : "text-gray-800"}`}>
                                        {c.name}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">{c.phone || "No phone"}</p>
                                </div>
                                {c._count.devices > 0 && (
                                    <span className="text-xs text-gray-400 shrink-0">{c._count.devices}d</span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* ── RIGHT: Detail panel ──────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">

                {/* empty state */}
                {!selectedId && (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <User size={40} strokeWidth={1} className="mb-3" />
                        <p className="text-sm">Select a customer to view activity</p>
                    </div>
                )}

                {/* loading */}
                {selectedId && detailLoading && (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                )}

                {/* content */}
                {selectedId && !detailLoading && detail && (
                    <>
                        {/* ── Customer header ── */}
                        <div className="bg-white border-b px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                                        {initials(detail.name)}
                                    </div>
                                    <div>
                                        {editing ? (
                                            <input
                                                value={editForm.name}
                                                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                                className="text-xl font-bold border-b-2 border-blue-500 focus:outline-none bg-transparent w-56"
                                                autoFocus
                                            />
                                        ) : (
                                            <h2 className="text-xl font-bold text-gray-900">{detail.name}</h2>
                                        )}
                                        <div className="flex items-center gap-4 mt-1 flex-wrap">
                                            {editing ? (
                                                <>
                                                    <input
                                                        value={editForm.phone}
                                                        onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                                                        placeholder="Phone"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36"
                                                    />
                                                    <input
                                                        value={editForm.address}
                                                        onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                                                        placeholder="Address"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
                                                    />
                                                    <input
                                                        value={editForm.email}
                                                        onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                                        placeholder="Email"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    {detail.phone && (
                                                        <span className="flex items-center gap-1 text-xs text-gray-500">
                                                            <Phone size={11} />{detail.phone}
                                                        </span>
                                                    )}
                                                    {detail.address && (
                                                        <span className="flex items-center gap-1 text-xs text-gray-500">
                                                            <MapPin size={11} />{detail.address}
                                                        </span>
                                                    )}
                                                    {detail.email && (
                                                        <span className="text-xs text-gray-400">{detail.email}</span>
                                                    )}
                                                    <span className="text-xs text-gray-300">Since {formatDate(detail.createdAt)}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* action buttons */}
                                <div className="flex items-center gap-2 shrink-0">
                                    {editing ? (
                                        <>
                                            <button
                                                onClick={() => setEditing(false)}
                                                className="p-1.5 rounded hover:bg-gray-100 text-gray-400"
                                            >
                                                <X size={15} />
                                            </button>
                                            <button
                                                onClick={saveEdit}
                                                disabled={editSaving}
                                                className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {editSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                Save
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={startEdit}
                                                className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                                title="Edit customer"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <Link
                                                href={`/customers/${detail.id}`}
                                                className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                                title="Open full page"
                                            >
                                                <ExternalLink size={14} />
                                            </Link>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* summary chips */}
                            <div className="flex items-center gap-3 mt-3">
                                <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                    <Smartphone size={11} />{detail.devices.length} device{detail.devices.length !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                    <Building2 size={11} />{detail.companies.length} compan{detail.companies.length !== 1 ? "ies" : "y"}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                    🎫 {allTickets.length} ticket{allTickets.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                        </div>

                        {/* ── Tabs ── */}
                        <div className="bg-white border-b px-6 flex gap-6">
                            {(["tickets", "devices", "companies"] as Tab[]).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`py-2.5 text-sm font-medium border-b-2 capitalize transition-colors ${tab === t
                                        ? "border-blue-600 text-blue-600"
                                        : "border-transparent text-gray-500 hover:text-gray-700"
                                        }`}
                                >
                                    {t}
                                    {t === "tickets" && allTickets.length > 0 && (
                                        <span className="ml-1.5 text-xs bg-blue-100 text-blue-600 rounded-full px-1.5">{allTickets.length}</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* ── Tab content ── */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">

                            {/* TICKETS TAB */}
                            {tab === "tickets" && (
                                allTickets.length === 0 ? (
                                    <EmptyState icon="🎫" message="No tickets for this customer yet" />
                                ) : (
                                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                                                    <th className="px-4 py-3 text-left font-medium">Ticket</th>
                                                    <th className="px-4 py-3 text-left font-medium">Device</th>
                                                    <th className="px-4 py-3 text-left font-medium">Status</th>
                                                    <th className="px-4 py-3 text-left font-medium">Priority</th>
                                                    <th className="px-4 py-3 text-left font-medium">Date</th>
                                                    <th className="px-4 py-3" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {allTickets.map(t => (
                                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-3 font-mono text-xs text-gray-500">#{t.id}</td>
                                                        <td className="px-4 py-3">
                                                            <span className="text-sm font-medium text-gray-800">{t.device.brand} {t.device.model}</span>
                                                            <span className="block text-xs text-gray-400">{t.device.type}</span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${t.ticketStatus.color}`}>
                                                                {t.ticketStatus.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${t.ticketPriority.color}`}>
                                                                {t.ticketPriority.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(t.createdAt)}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <Link href={`/tickets/${t.id}`} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                                                View <ExternalLink size={10} />
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            )}

                            {/* DEVICES TAB */}
                            {tab === "devices" && (
                                detail.devices.length === 0 ? (
                                    <EmptyState icon="📱" message="No devices registered yet" />
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {detail.devices.map(d => (
                                            <div key={d.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                                        <Smartphone size={16} className="text-gray-500" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-sm text-gray-800 truncate">{d.brand} {d.model}</p>
                                                        <p className="text-xs text-gray-400">{d.type}</p>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-400 mt-3">{d.tickets.length} ticket{d.tickets.length !== 1 ? "s" : ""}</p>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}

                            {/* COMPANIES TAB */}
                            {tab === "companies" && (
                                detail.companies.length === 0 ? (
                                    <EmptyState icon="🏢" message="Not linked to any company" />
                                ) : (
                                    <div className="space-y-2">
                                        {detail.companies.map(cc => (
                                            <div key={cc.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                                                        <Building2 size={14} className="text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm text-gray-800">{cc.company.name}</p>
                                                        {cc.company.phone && <p className="text-xs text-gray-400">{cc.company.phone}</p>}
                                                    </div>
                                                </div>
                                                <Link href={`/companies/${cc.company.id}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                                    View <ExternalLink size={10} />
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ── Create modal ─────────────────────────────────────────────────── */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-base font-semibold">New Customer</h2>
                            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleCreate} className="space-y-3">
                            <Field label="Name" required>
                                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                            </Field>
                            <Field label="Phone">
                                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </Field>
                            <Field label="Email">
                                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </Field>
                            <Field label="Address">
                                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </Field>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
                                    {saving ? "Creating…" : "Create"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
                {label}{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {children}
        </div>
    );
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-3xl mb-3">{icon}</span>
            <p className="text-sm">{message}</p>
        </div>
    );
}
