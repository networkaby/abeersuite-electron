import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const statusColors: Record<string, string> = {
    RECEIVED: "bg-gray-100 text-gray-600",
    DIAGNOSING: "bg-blue-100 text-blue-600",
    REPAIRING: "bg-yellow-100 text-yellow-600",
    ESCALATED: "bg-orange-100 text-orange-600",
    RECEIVED_BACK: "bg-purple-100 text-purple-600",
    READY: "bg-green-100 text-green-600",
    RETURNED: "bg-gray-100 text-gray-400",
};

const priorityColors: Record<string, string> = {
    LOW: "bg-gray-100 text-gray-500",
    NORMAL: "bg-blue-50 text-blue-500",
    HIGH: "bg-orange-100 text-orange-500",
    URGENT: "bg-red-100 text-red-600",
};

export default async function CustomerDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const customer = await prisma.customer.findUnique({
        where: { id: Number(id) },
        include: {
            devices: {
                include: {
                    ticket: {
                        include: {
                            technician: true,
                            serviceCenter: true,
                        },
                    },
                },
            },
        },
    });

    if (!customer) notFound();

    const totalTickets = customer.devices.filter((d) => d.ticket).length;
    const openTickets = customer.devices.filter(
        (d) => d.ticket && !["RETURNED"].includes(d.ticket.status)
    ).length;

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/customers" className="text-gray-400 hover:text-gray-600">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">{customer.name}</h1>
                    <p className="text-gray-400 text-sm">
                        Customer since {new Date(customer.createdAt).toLocaleDateString()}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Left — Info */}
                <div className="space-y-4">
                    {/* Contact */}
                    <div className="bg-white rounded-xl shadow p-5">
                        <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
                            Contact Info
                        </h2>
                        <div className="space-y-2 text-sm">
                            <div>
                                <p className="text-gray-400 text-xs">Phone</p>
                                <p className="font-medium">{customer.phone}</p>
                            </div>
                            <div>
                                <p className="text-gray-400 text-xs">Email</p>
                                <p className="font-medium">{customer.email || "—"}</p>
                            </div>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="bg-white rounded-xl shadow p-5">
                        <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
                            Summary
                        </h2>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Total Devices</span>
                                <span className="font-bold">{customer.devices.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Total Tickets</span>
                                <span className="font-bold">{totalTickets}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Open Tickets</span>
                                <span className="font-bold text-blue-600">{openTickets}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right — Device & Ticket History */}
                <div className="col-span-2 space-y-4">
                    {customer.devices.length === 0 ? (
                        <div className="bg-white rounded-xl shadow p-12 text-center text-gray-400">
                            No devices yet.
                        </div>
                    ) : (
                        customer.devices.map((device) => (
                            <div key={device.id} className="bg-white rounded-xl shadow p-5">
                                {/* Device Header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="font-semibold">
                                            {device.brand} {device.model}
                                        </p>
                                        <p className="text-gray-400 text-xs">{device.type}</p>
                                    </div>
                                    {device.ticket && (
                                        <Link
                                            href={`/tickets/${device.ticket.id}`}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-medium"
                                        >
                                            Update
                                        </Link>
                                    )}
                                </div>

                                {/* Problem */}
                                <div className="mb-4">
                                    <p className="text-gray-400 text-xs uppercase mb-1">Problem</p>
                                    <p className="text-sm text-gray-700">{device.problem}</p>
                                </div>

                                {/* Ticket Info */}
                                {device.ticket ? (
                                    <div className="border-t pt-4 space-y-2 text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400 text-xs">Ticket #{device.ticket.id}</span>
                                            <div className="flex gap-2">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColors[device.ticket.priority]}`}>
                                                    {device.ticket.priority}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[device.ticket.status]}`}>
                                                    {device.ticket.status.replace("_", " ")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-xs text-gray-500">
                                            <span>
                                                Technician: {device.ticket.technician?.name || "Unassigned"}
                                            </span>
                                            <span>
                                                {new Date(device.ticket.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                        {device.ticket.estimatedCost && (
                                            <div className="text-xs text-green-600 font-medium">
                                                Est. Cost: ৳ {device.ticket.estimatedCost}
                                            </div>
                                        )}
                                        {device.ticket.escalated && (
                                            <div className="text-xs text-orange-500">
                                                Escalated to: {device.ticket.serviceCenter?.name || "External"}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="border-t pt-3 text-xs text-gray-400">
                                        No ticket for this device.
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}