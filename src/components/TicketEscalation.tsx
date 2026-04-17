"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";

interface Props {
    ticket: {
        id: number;
    };
    onClose: () => void;
}

type ServiceCenterOption = {
    id: number;
    name: string;
};

type EscalationFormData = {
    serviceCenterId: string;
    externalRef: string;
    escalatedAt: string;
    expectedReturn: string;
};

export default function TicketEscalation({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const [serviceCenters, setServiceCenters] = useState<ServiceCenterOption[]>([]);
    const { register, handleSubmit, formState: { isSubmitting } } = useForm({
        defaultValues: {
            serviceCenterId: "",
            externalRef: "",
            escalatedAt: new Date().toISOString().split("T")[0],
            expectedReturn: "",
        },
    });

    useEffect(() => {
        axios.get("/api/service-centers").then((r) => setServiceCenters(r.data));
    }, []);

    const onSubmit = async (data: EscalationFormData) => {
        try {
            await axios.put(`/api/tickets/${ticket.id}`, {
                status: "S4",
                escalated: true,
                escalatedAt: data.escalatedAt,
                expectedReturn: data.expectedReturn || null,
                externalRef: data.externalRef || null,
                serviceCenterId: data.serviceCenterId || null,
                changedBy: session?.user?.id,
                logNote: `Escalated to ${serviceCenters.find(s => s.id === Number(data.serviceCenterId))?.name || "external service center"}`,
            });
            toast.success("Ticket escalated");
            onClose();
        } catch {
            toast.error("Failed to escalate ticket");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Escalate to Service Center</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Service Center</label>
                        <select
                            {...register("serviceCenterId")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Select service center...</option>
                            {serviceCenters.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            External Ref # <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            {...register("externalRef")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Job number from service center"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Escalated Date</label>
                            <input
                                type="date"
                                {...register("escalatedAt")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Expected Return <span className="text-gray-400">(optional)</span>
                            </label>
                            <input
                                type="date"
                                {...register("expectedReturn")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
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
                            className="flex-1 bg-orange-500 text-white rounded-lg py-2 text-sm hover:bg-orange-600 disabled:opacity-50"
                        >
                            {isSubmitting ? "Escalating..." : "Escalate"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}