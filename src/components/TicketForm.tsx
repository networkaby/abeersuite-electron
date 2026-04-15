"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";

const schema = z.object({
    customerId: z.string().min(1, "Customer is required"),
    deviceType: z.string().min(1, "Device type is required"),
    brand: z.string().min(1, "Brand is required"),
    model: z.string().min(1, "Model is required"),
    problem: z.string().min(1, "Problem is required"),
    priority: z.string(),
    notes: z.string().optional(),
    accessInfo: z.string().optional(),
    estimatedCost: z.string().optional(),
    technicianId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    onClose: () => void;
}

export default function TicketForm({ onClose }: Props) {
    const { data: session } = useSession();
    const [customers, setCustomers] = useState<any[]>([]);
    const [technicians, setTechnicians] = useState<any[]>([]);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { priority: "NORMAL" },
    });

    useEffect(() => {
        axios.get("/api/customers").then((r) => setCustomers(r.data));
        axios.get("/api/users").then((r) => setTechnicians(r.data));
    }, []);

    const onSubmit = async (data: FormData) => {
        try {
            await axios.post("/api/tickets", {
                ...data,
                createdBy: session?.user?.id,
            });
            toast.success("Ticket created");
            onClose();
        } catch {
            toast.error("Failed to create ticket");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">New Ticket</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Customer */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Customer</label>
                        <select
                            {...register("customerId")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Select customer...</option>
                            {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name} — {c.phone}
                                </option>
                            ))}
                        </select>
                        {errors.customerId && <p className="text-red-500 text-xs mt-1">{errors.customerId.message}</p>}
                    </div>

                    {/* Device Info */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Device Type</label>
                            <input
                                {...register("deviceType")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Laptop, Printer..."
                            />
                            {errors.deviceType && <p className="text-red-500 text-xs mt-1">{errors.deviceType.message}</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Brand</label>
                            <input
                                {...register("brand")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="HP, Dell..."
                            />
                            {errors.brand && <p className="text-red-500 text-xs mt-1">{errors.brand.message}</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Model</label>
                            <input
                                {...register("model")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Model number"
                            />
                            {errors.model && <p className="text-red-500 text-xs mt-1">{errors.model.message}</p>}
                        </div>
                    </div>

                    {/* Problem */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Problem Description</label>
                        <textarea
                            {...register("problem")}
                            rows={3}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Describe the issue..."
                        />
                        {errors.problem && <p className="text-red-500 text-xs mt-1">{errors.problem.message}</p>}
                    </div>

                    {/* Priority + Technician */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Priority</label>
                            <select
                                {...register("priority")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="LOW">Low</option>
                                <option value="NORMAL">Normal</option>
                                <option value="HIGH">High</option>
                                <option value="URGENT">Urgent</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Assign Technician <span className="text-gray-400">(optional)</span></label>
                            <select
                                {...register("technicianId")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Unassigned</option>
                                {technicians.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Access Info + Estimated Cost */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Access Info <span className="text-gray-400">(PIN/Password)</span></label>
                            <input
                                {...register("accessInfo")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Device PIN or password"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Estimated Cost <span className="text-gray-400">(optional)</span></label>
                            <input
                                {...register("estimatedCost")}
                                type="number"
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                        <textarea
                            {...register("notes")}
                            rows={2}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Internal notes..."
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Creating..." : "Create Ticket"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}