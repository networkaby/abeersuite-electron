"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Search, Plus, User, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";

interface Customer {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: string;
    account: { id: number } | null;
    _count: { companies: number; devices: number };
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [filtered, setFiltered] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await axios.get<Customer[]>("/api/customers");
            setCustomers(res.data);
        } catch {
            toast.error("Failed to load customers");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    useEffect(() => {
        if (!search) { setFiltered(customers); return; }
        const s = search.toLowerCase();
        setFiltered(customers.filter(c =>
            c.name.toLowerCase().includes(s) ||
            (c.phone ?? "").includes(s) ||
            (c.email ?? "").toLowerCase().includes(s)
        ));
    }, [customers, search]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/customers", form);
            toast.success("Customer created");
            setShowCreate(false);
            setForm({ name: "", phone: "", email: "", address: "" });
            load();
        } catch {
            toast.error("Failed to create customer");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <User size={22} className="text-blue-600" />
                    <h1 className="text-3xl font-bold">Customers</h1>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
                >
                    <Plus size={16} /> New Customer
                </button>
            </div>

            {/* Search */}
            <div className="bg-white rounded-lg shadow p-4 mb-4">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, phone, or email..."
                        className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <p className="text-sm text-gray-500 mt-2">
                    Showing <span className="font-medium text-gray-700">{filtered.length}</span> of {customers.length} customers
                </p>
            </div>

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-semibold mb-4">New Customer</h2>
                        <form onSubmit={handleCreate} className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">Name <span className="text-red-500">*</span></label>
                                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Phone</label>
                                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Email <span className="text-gray-400">(optional)</span></label>
                                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Address <span className="text-gray-400">(optional)</span></label>
                                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
                                    {saving ? "Creating..." : "Create Customer"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Table */}
            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    {search ? "No customers match your search." : "No customers yet."}
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-6 py-3 text-left">#</th>
                                <th className="px-6 py-3 text-left">Name</th>
                                <th className="px-6 py-3 text-left">Phone</th>
                                <th className="px-6 py-3 text-left">Email</th>
                                <th className="px-6 py-3 text-left">Companies</th>
                                <th className="px-6 py-3 text-left">Devices</th>
                                <th className="px-6 py-3 text-left">Since</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(c => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-400">{c.id}</td>
                                    <td className="px-6 py-4 font-medium">{c.name}</td>
                                    <td className="px-6 py-4 text-gray-600">{c.phone || "—"}</td>
                                    <td className="px-6 py-4 text-gray-600">{c.email || "—"}</td>
                                    <td className="px-6 py-4 text-gray-600">{c._count.companies}</td>
                                    <td className="px-6 py-4 text-gray-600">{c._count.devices}</td>
                                    <td className="px-6 py-4 text-gray-400">{formatDate(c.createdAt)}</td>
                                    <td className="px-6 py-4">
                                        <Link href={`/customers/${c.id}`} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 inline-flex">
                                            <Eye size={15} />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
