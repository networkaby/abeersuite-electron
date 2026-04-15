"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Trash2, Search, X } from "lucide-react";
import { toast } from "sonner";
import CustomerForm from "@/components/CustomerForm";

interface Customer {
    id: number;
    name: string;
    phone: string;
    email?: string;
    devices: any[];
    createdAt: string;
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [filtered, setFiltered] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
    const [search, setSearch] = useState("");

    const fetchCustomers = async () => {
        try {
            const res = await axios.get("/api/customers");
            setCustomers(res.data);
        } catch {
            toast.error("Failed to load customers");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers();
    }, []);

    // Apply search
    useEffect(() => {
        if (!search) {
            setFiltered(customers);
            return;
        }
        const s = search.toLowerCase();
        setFiltered(
            customers.filter(
                (c) =>
                    c.name.toLowerCase().includes(s) ||
                    c.phone.includes(s) ||
                    c.email?.toLowerCase().includes(s)
            )
        );
    }, [search, customers]);

    const handleDelete = async (id: number) => {
        if (!confirm("Delete this customer?")) return;
        try {
            await axios.delete(`/api/customers/${id}`);
            toast.success("Customer deleted");
            fetchCustomers();
        } catch {
            toast.error("Failed to delete customer");
        }
    };

    const handleFormClose = () => {
        setShowForm(false);
        setEditCustomer(null);
        fetchCustomers();
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Customers</h1>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} />
                    Add Customer
                </button>
            </div>

            {(showForm || editCustomer) && (
                <CustomerForm customer={editCustomer} onClose={handleFormClose} />
            )}

            {/* Search */}
            <div className="bg-white rounded-lg shadow p-4 mb-4">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, phone, email..."
                        className="w-full pl-9 pr-10 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>
                <div className="mt-2 text-sm text-gray-500">
                    Showing <span className="font-medium text-gray-700">{filtered.length}</span> of{" "}
                    <span className="font-medium text-gray-700">{customers.length}</span> customers
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    {search ? "No customers match your search." : "No customers yet. Add your first one!"}
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
                                <th className="px-6 py-3 text-left">Devices</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map((c) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-400">{c.id}</td>
                                    <td className="px-6 py-4 font-medium">{c.name}</td>
                                    <td className="px-6 py-4">{c.phone}</td>
                                    <td className="px-6 py-4 text-gray-500">{c.email || "—"}</td>
                                    <td className="px-6 py-4">{c.devices.length}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setEditCustomer(c)}
                                                className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(c.id)}
                                                className="p-1.5 rounded hover:bg-red-50 text-red-500"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
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