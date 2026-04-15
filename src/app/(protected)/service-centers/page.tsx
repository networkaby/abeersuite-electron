"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ServiceCenterForm from "@/components/ServiceCenterForm";

interface ServiceCenter {
    id: number;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    _count: { tickets: number };
}

export default function ServiceCentersPage() {
    const [serviceCenters, setServiceCenters] = useState<ServiceCenter[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState<ServiceCenter | null>(null);

    const fetchServiceCenters = async () => {
        try {
            const res = await axios.get("/api/service-centers");
            setServiceCenters(res.data);
        } catch {
            toast.error("Failed to load service centers");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchServiceCenters();
    }, []);

    const handleDelete = async (id: number) => {
        if (!confirm("Delete this service center?")) return;
        try {
            await axios.delete(`/api/service-centers/${id}`);
            toast.success("Deleted successfully");
            fetchServiceCenters();
        } catch {
            toast.error("Failed to delete");
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Service Centers</h1>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} />
                    Add Service Center
                </button>
            </div>

            {(showForm || editItem) && (
                <ServiceCenterForm
                    serviceCenter={editItem ?? undefined}
                    onClose={() => {
                        setShowForm(false);
                        setEditItem(null);
                        fetchServiceCenters();
                    }}
                />
            )}

            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : serviceCenters.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    No service centers yet. Add your first one!
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
                                <th className="px-6 py-3 text-left">Address</th>
                                <th className="px-6 py-3 text-left">Tickets</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {serviceCenters.map((s) => (
                                <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-400">{s.id}</td>
                                    <td className="px-6 py-4 font-medium">{s.name}</td>
                                    <td className="px-6 py-4">{s.phone}</td>
                                    <td className="px-6 py-4 text-gray-500">{s.email || "—"}</td>
                                    <td className="px-6 py-4 text-gray-500">{s.address || "—"}</td>
                                    <td className="px-6 py-4">{s._count.tickets}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setEditItem(s)}
                                                className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(s.id)}
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