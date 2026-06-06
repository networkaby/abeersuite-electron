"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ServiceCenterForm from "@/modules/repairing/components/ServiceCenterForm";
import { useDeleteWithConfirm } from "@/shared/hooks";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

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

    useEffect(() => { fetchServiceCenters(); }, []);

    const { remove: handleDelete } = useDeleteWithConfirm({
        url: (id) => `/api/service-centers/${id}`,
        message: () => "Delete this service center?",
        successMessage: "Deleted successfully",
        errorMessage: "Failed to delete",
        onSuccess: () => fetchServiceCenters(),
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Service Centers</h1>
                <Button type="button" onClick={() => setShowForm(true)}>
                    <Plus size={16} /> Add Service Center
                </Button>
            </div>

            {(showForm || editItem) && (
                <ServiceCenterForm
                    serviceCenter={editItem ?? undefined}
                    onClose={() => { setShowForm(false); setEditItem(null); fetchServiceCenters(); }}
                />
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : serviceCenters.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground shadow">
                    No service centers yet. Add your first one!
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Address</TableHead>
                                <TableHead>Tickets</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {serviceCenters.map((s) => (
                                <TableRow key={s.id}>
                                    <TableCell className="text-muted-foreground">{s.id}</TableCell>
                                    <TableCell className="font-medium">{s.name}</TableCell>
                                    <TableCell>{s.phone}</TableCell>
                                    <TableCell className="text-muted-foreground">{s.email || "—"}</TableCell>
                                    <TableCell className="text-muted-foreground">{s.address || "—"}</TableCell>
                                    <TableCell>{s._count.tickets}</TableCell>
                                    <TableCell>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => setEditItem(s)}
                                            >
                                                <Pencil size={14} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="icon-sm"
                                                onClick={() => handleDelete(s.id)}
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
