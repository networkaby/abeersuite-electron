import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDate } from "@/lib/format-date";

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
                    tickets: {
                        orderBy: { createdAt: "desc" },
                        include: {
                            primaryOwner: true,
                            serviceCenter: true,
                            ticketStatus: { select: { label: true, color: true, isTerminal: true } },
                            ticketPriority: { select: { label: true, color: true } },
                        },
                    },
                },
            },
        },
    });

    if (!customer) notFound();

    const totalTickets = customer.devices.reduce(
        (acc, d) => acc + d.tickets.length,
        0
    );
    const openTickets = customer.devices.reduce(
        (acc, d) =>
            acc + d.tickets.filter((t) => !t.ticketStatus.isTerminal).length,
        0
    );

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
                        Customer since {formatDate(customer.createdAt)}
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
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <p className="font-semibold">
                                            {device.brand} {device.model}
                                        </p>
                                        <p className="text-gray-400 text-xs">{device.type}</p>
                                    </div>
                                    <span className="text-xs text-gray-400">
                                        {device.tickets.length} ticket{device.tickets.length !== 1 ? "s" : ""}
                                    </span>
                                </div>

                                {/* Problem */}
                                <div className="mb-4">
                                    <p className="text-gray-400 text-xs uppercase mb-1">Problem</p>
                                    <p className="text-sm text-gray-700">{device.problem}</p>
                                </div>

                                {/* Tickets */}
                                {device.tickets.length > 0 ? (
                                    <div className="space-y-3">
                                        {device.tickets.map((ticket, index) => (
                                            <div
                                                key={ticket.id}
                                                className={`rounded-lg p-3 text-sm space-y-2 ${index === 0 ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"
                                                    }`}
                                            >
                                                {/* Ticket Header */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-gray-500 text-xs font-medium">
                                                            Ticket #{ticket.id}
                                                        </span>
                                                        {index === 0 && (
                                                            <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">
                                                                Latest
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1.5">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ticket.ticketPriority.color}`}>
                                                            {ticket.ticketPriority.label}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ticket.ticketStatus.color}`}>
                                                            {ticket.ticketStatus.label}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Ticket Details */}
                                                <div className="flex justify-between text-xs text-gray-500">
                                                    <span>
                                                        Technician: {ticket.primaryOwner?.name || "Unassigned"}
                                                    </span>
                                                    <span>
                                                        {formatDate(ticket.createdAt)}
                                                    </span>
                                                </div>

                                                {ticket.estimatedCost && (
                                                    <div className="text-xs text-green-600 font-medium">
                                                        Est. Cost: ₹ {ticket.estimatedCost}
                                                    </div>
                                                )}

                                                {ticket.escalated && (
                                                    <div className="text-xs text-orange-500">
                                                        Escalated to: {ticket.serviceCenter?.name || "External"}
                                                    </div>
                                                )}

                                                <Link
                                                    href={`/tickets/${ticket.id}`}
                                                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-medium"
                                                >
                                                    Update
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="border-t pt-3 text-xs text-gray-400">
                                        No tickets for this device.
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
