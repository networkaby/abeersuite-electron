"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import {
    Search, Plus, Building2, Phone, MapPin,
    User, Smartphone, ExternalLink, Pencil, X, Check, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanyListItem {
    id: number;
    name: string;
    phone: string | null;
    companyReg: string | null;
    _count: { customers: number; devices: number };
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

type Tab = "contacts" | "devices";

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompaniesPage() {
    const [companies, setCompanies] = useState<CompanyListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CompanyDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tab, setTab] = useState<Tab>("contacts");

    // create
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [saving, setSaving] = useState(false);

    // inline edit
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
    const [editSaving, setEditSaving] = useState(false);

    // ── Load list ──────────────────────────────────────────────────────────────

    const loadList = useCallback(async () => {
        try {
            const res = await axios.get<CompanyListItem[]>("/api/companies");
            setCompanies(res.data);
        } catch {
            toast.error("Failed to load companies");
        }
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    // ── Load detail ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!selectedId) { setDetail(null); return; }
        setDetailLoading(true);
        axios.get<CompanyDetail>(`/api/companies/${selectedId}`)
            .then(r => { setDetail(r.data); setTab("contacts"); })
            .catch(() => toast.error("Failed to load company"))
            .finally(() => setDetailLoading(false));
    }, [selectedId]);

    // ── Create ─────────────────────────────────────────────────────────────────

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("Company name is required"); return; }
        setSaving(true);
        try {
            const res = await axios.post<CompanyListItem>("/api/companies", form);
            toast.success("Company created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "", companyReg: "", taxId: "" });
            await loadList();
            setSelectedId(res.data.id);
        } catch {
            toast.error("Failed to create company");
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
            const [listRes, detailRes] = await Promise.all([
                axios.get<CompanyListItem[]>("/api/companies"),
                axios.get<CompanyDetail>(`/api/companies/${detail.id}`),
            ]);
            setCompanies(listRes.data);
            setDetail(detailRes.data);
        } catch {
            toast.error("Failed to save");
        } finally {
            setEditSaving(false);
        }
    };

    // ── Derived ────────────────────────────────────────────────────────────────

    const filtered = search
        ? companies.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone ?? "").includes(search) ||
            (c.companyReg ?? "").toLowerCase().includes(search.toLowerCase())
        )
        : companies;

    const allTickets = detail
        ? detail.devices.flatMap(d => d.tickets.map(t => ({ ...t, device: d })))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="-m-8 flex" style={{ height: "100vh" }}>

            {/* ── LEFT: Company list ───────────────────────────────────────────── */}
            <div className="w-72 flex flex-col border-r bg-white shrink-0">

                {/* header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-purple-600" />
                        <span className="font-semibold text-sm">Companies</span>
                        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{companies.length}</span>
                    </div>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-1 text-xs bg-purple-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-purple-700"
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
                            placeholder="Search name, phone, reg…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                    </div>
                </div>

                {/* list */}
                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-8">
                            {search ? "No matches" : "No companies yet"}
                        </p>
                    ) : (
                        filtered.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-50 transition-colors ${selectedId === c.id
                                    ? "bg-purple-50 border-l-2 border-l-purple-600"
                                    : "hover:bg-gray-50 border-l-2 border-l-transparent"
                                    }`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${selectedId === c.id ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                                    {initials(c.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm font-medium truncate ${selectedId === c.id ? "text-purple-700" : "text-gray-800"}`}>
                                        {c.name}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">{c.phone || "No phone"}</p>
                                </div>
                                {c._count.customers > 0 && (
                                    <span className="text-xs text-gray-400 shrink-0">{c._count.customers}c</span>
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
                        <Building2 size={40} strokeWidth={1} className="mb-3" />
                        <p className="text-sm">Select a company to view details</p>
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
                        {/* ── Company header ── */}
                        <div className="bg-white border-b px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                                        {initials(detail.name)}
                                    </div>
                                    <div>
                                        {editing ? (
                                            <input
                                                value={editForm.name}
                                                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                                className="text-xl font-bold border-b-2 border-purple-500 focus:outline-none bg-transparent w-56"
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
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 w-32"
                                                    />
                                                    <input
                                                        value={editForm.address}
                                                        onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                                                        placeholder="Address"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 w-44"
                                                    />
                                                    <input
                                                        value={editForm.email}
                                                        onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                                        placeholder="Email"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 w-40"
                                                    />
                                                    <input
                                                        value={editForm.companyReg}
                                                        onChange={e => setEditForm(f => ({ ...f, companyReg: e.target.value }))}
                                                        placeholder="Company Reg"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 w-32"
                                                    />
                                                    <input
                                                        value={editForm.taxId}
                                                        onChange={e => setEditForm(f => ({ ...f, taxId: e.target.value }))}
                                                        placeholder="Tax / VAT"
                                                        className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 w-28"
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
                                                    {detail.companyReg && (
                                                        <span className="text-xs text-gray-400">Reg: {detail.companyReg}</span>
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
                                                className="flex items-center gap-1 text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50"
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
                                                title="Edit company"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <Link
                                                href={`/companies/${detail.id}`}
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
                                    <User size={11} />{detail.customers.length} contact{detail.customers.length !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                    <Smartphone size={11} />{detail.devices.length} device{detail.devices.length !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                    🎫 {allTickets.length} ticket{allTickets.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                        </div>

                        {/* ── Tabs ── */}
                        <div className="bg-white border-b px-6 flex gap-6">
                            {(["contacts", "devices"] as Tab[]).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`py-2.5 text-sm font-medium border-b-2 capitalize transition-colors ${tab === t
                                        ? "border-purple-600 text-purple-600"
                                        : "border-transparent text-gray-500 hover:text-gray-700"
                                        }`}
                                >
                                    {t}
                                    {t === "contacts" && detail.customers.length > 0 && (
                                        <span className="ml-1.5 text-xs bg-purple-100 text-purple-600 rounded-full px-1.5">{detail.customers.length}</span>
                                    )}
                                    {t === "devices" && detail.devices.length > 0 && (
                                        <span className="ml-1.5 text-xs bg-purple-100 text-purple-600 rounded-full px-1.5">{detail.devices.length}</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* ── Tab content ── */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">

                            {/* CONTACTS TAB */}
                            {tab === "contacts" && (
                                detail.customers.length === 0 ? (
                                    <EmptyState icon="👤" message="No contacts linked to this company" />
                                ) : (
                                    <div className="space-y-2">
                                        {detail.customers.map(cc => (
                                            <div key={cc.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                                                        <User size={14} className="text-purple-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm text-gray-800">{cc.customer.name}</p>
                                                        {cc.customer.phone && <p className="text-xs text-gray-400">{cc.customer.phone}</p>}
                                                    </div>
                                                </div>
                                                <Link href={`/customers/${cc.customer.id}`} className="text-xs text-purple-600 hover:underline flex items-center gap-1">
                                                    View <ExternalLink size={10} />
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}

                            {/* DEVICES TAB */}
                            {tab === "devices" && (
                                detail.devices.length === 0 ? (
                                    <EmptyState icon="📱" message="No devices registered to this company" />
                                ) : (
                                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                                                    <th className="px-4 py-3 text-left font-medium">Device</th>
                                                    <th className="px-4 py-3 text-left font-medium">Type</th>
                                                    <th className="px-4 py-3 text-left font-medium">Latest Ticket</th>
                                                    <th className="px-4 py-3 text-left font-medium">Status</th>
                                                    <th className="px-4 py-3 text-left font-medium">Tickets</th>
                                                    <th className="px-4 py-3" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {detail.devices.map(d => {
                                                    const latest = d.tickets[0];
                                                    return (
                                                        <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <span className="text-sm font-medium text-gray-800">{d.brand} {d.model}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-xs text-gray-400">{d.type}</td>
                                                            <td className="px-4 py-3 font-mono text-xs text-gray-500">
                                                                {latest ? `#${latest.id}` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {latest ? (
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${latest.ticketStatus.color}`}>
                                                                        {latest.ticketStatus.label}
                                                                    </span>
                                                                ) : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 text-xs text-gray-500">{d.tickets.length}</td>
                                                            <td className="px-4 py-3 text-right">
                                                                {latest && (
                                                                    <Link href={`/tickets/${latest.id}`} className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline">
                                                                        View <ExternalLink size={10} />
                                                                    </Link>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
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
                            <h2 className="text-base font-semibold">New Company</h2>
                            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleCreate} className="space-y-3">
                            <Field label="Company Name" required>
                                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" autoFocus />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Phone">
                                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                </Field>
                                <Field label="Email">
                                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                </Field>
                            </div>
                            <div className="p-3 bg-purple-50 rounded-lg border border-purple-100 space-y-3">
                                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Business Details</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Company Reg">
                                        <input value={form.companyReg} onChange={e => setForm(f => ({ ...f, companyReg: e.target.value }))}
                                            className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </Field>
                                    <Field label="Tax ID / VAT">
                                        <input value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))}
                                            className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </Field>
                                </div>
                            </div>
                            <Field label="Address">
                                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                            </Field>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                                <button type="submit" disabled={saving} className="flex-1 bg-purple-600 text-white rounded-lg py-2 text-sm hover:bg-purple-700 disabled:opacity-50">
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
