"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Search, X, User, Building2, Link2 } from "lucide-react";
import { toast } from "sonner";
import AccountForm from "@/components/AccountForm";
import Link from "next/link";

interface Account {
    id: number;
    type: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    companyReg?: string | null;
    isActive: boolean;
    createdAt: string;
    devices: { id: number }[];
    _count: { asIndividual: number; asCompany: number };
}

const TYPE_FILTERS = [
    { label: "All", value: "" },
    { label: "Individuals", value: "individual" },
    { label: "Companies", value: "company" },
];

export default function AccountsPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [filtered, setFiltered] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editAccount, setEditAccount] = useState<Account | null>(null);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("");

    const fetchAccounts = async () => {
        setLoading(true);
        try {
            const res = await axios.get("/api/accounts");
            setAccounts(res.data);
        } catch {
            toast.error("Failed to load accounts");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAccounts(); }, []);

    useEffect(() => {
        let list = accounts;
        if (typeFilter) list = list.filter(a => a.type === typeFilter);
        if (search) {
            const s = search.toLowerCase();
            list = list.filter(a =>
                a.name.toLowerCase().includes(s) ||
                a.phone?.includes(s) ||
                a.email?.toLowerCase().includes(s) ||
                a.companyReg?.toLowerCase().includes(s)
            );
        }
        setFiltered(list);
    }, [search, typeFilter, accounts]);

    const handleFormClose = (created?: { id: number; name: string; type: string }) => {
        setShowForm(false);
        setEditAccount(null);
        if (created) fetchAccounts();
    };

    const individuals = accounts.filter(a => a.type === "individual").length;
    const companies = accounts.filter(a => a.type === "company").length;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Accounts</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {individuals} individual{individuals !== 1 ? "s" : ""} · {companies} compan{companies !== 1 ? "ies" : "y"}
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} /> New Account
                </button>
            </div>

            {(showForm || editAccount) && (
                <AccountForm account={editAccount ?? undefined} onClose={handleFormClose} />
            )}

            {/* Search + Filter */}
            <div className="bg-white rounded-lg shadow p-4 mb-4 space-y-3">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by name, phone, email, company reg…"
                            className="w-full pl-9 pr-10 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {search && (
                            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                <X size={15} />
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1">
                        {TYPE_FILTERS.map(f => (
                            <button
                                key={f.value}
                                onClick={() => setTypeFilter(f.value)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                    typeFilter === f.value
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-sm text-gray-500">
                    Showing <span className="font-medium text-gray-700">{filtered.length}</span> of{" "}
                    <span className="font-medium text-gray-700">{accounts.length}</span> accounts
                </p>
            </div>

            {loading ? (
                <p className="text-gray-500">Loading…</p>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    {search || typeFilter ? "No accounts match your filter." : "No accounts yet. Add your first one!"}
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-6 py-3 text-left w-12">#</th>
                                <th className="px-6 py-3 text-left">Name</th>
                                <th className="px-6 py-3 text-left">Type</th>
                                <th className="px-6 py-3 text-left">Phone</th>
                                <th className="px-6 py-3 text-left">Email</th>
                                <th className="px-6 py-3 text-left">Links</th>
                                <th className="px-6 py-3 text-left">Devices</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(a => (
                                <tr key={a.id} className={`hover:bg-gray-50 ${!a.isActive ? "opacity-50" : ""}`}>
                                    <td className="px-6 py-4 text-gray-400">{a.id}</td>
                                    <td className="px-6 py-4">
                                        <Link href={`/accounts/${a.id}`} className="font-medium hover:text-blue-600 hover:underline">
                                            {a.name}
                                        </Link>
                                        {a.companyReg && <p className="text-xs text-gray-400">{a.companyReg}</p>}
                                    </td>
                                    <td className="px-6 py-4">
                                        {a.type === "company" ? (
                                            <span className="flex items-center gap-1 text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full w-fit">
                                                <Building2 size={11} /> Company
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full w-fit">
                                                <User size={11} /> Individual
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">{a.phone || "—"}</td>
                                    <td className="px-6 py-4 text-gray-500">{a.email || "—"}</td>
                                    <td className="px-6 py-4">
                                        {(a._count.asIndividual + a._count.asCompany) > 0 ? (
                                            <span className="flex items-center gap-1 text-xs text-gray-500">
                                                <Link2 size={12} />
                                                {a.type === "individual" ? `${a._count.asIndividual} co.` : `${a._count.asCompany} people`}
                                            </span>
                                        ) : (
                                            <span className="text-gray-300 text-xs">—</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">{a.devices.length}</td>
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={() => setEditAccount(a)}
                                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                                        >
                                            <Pencil size={15} />
                                        </button>
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
