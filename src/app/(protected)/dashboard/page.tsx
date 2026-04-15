import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export default async function DashboardPage() {
    const session = await auth();

    const [total, open, escalated, ready] = await Promise.all([
        prisma.ticket.count(),
        prisma.ticket.count({
            where: { status: { in: ["RECEIVED", "DIAGNOSING", "REPAIRING"] } },
        }),
        prisma.ticket.count({
            where: { escalated: true },
        }),
        prisma.ticket.count({
            where: { status: "READY" },
        }),
    ]);

    const recentTickets = await prisma.ticket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
            device: { include: { customer: true } },
            technician: true,
        },
    });

    const statusColors: Record<string, string> = {
        RECEIVED: "bg-gray-100 text-gray-600",
        DIAGNOSING: "bg-blue-100 text-blue-600",
        REPAIRING: "bg-yellow-100 text-yellow-600",
        ESCALATED: "bg-orange-100 text-orange-600",
        RECEIVED_BACK: "bg-purple-100 text-purple-600",
        READY: "bg-green-100 text-green-600",
        RETURNED: "bg-gray-100 text-gray-400",
    };

    return (
        <div>
            <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
            <p className="text-gray-500 mb-8">Welcome back, {session?.user?.name}!</p>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Total Tickets</p>
                    <p className="text-3xl font-bold mt-1">{total}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Open</p>
                    <p className="text-3xl font-bold mt-1 text-blue-600">{open}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Escalated</p>
                    <p className="text-3xl font-bold mt-1 text-yellow-600">{escalated}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Ready for Pickup</p>
                    <p className="text-3xl font-bold mt-1 text-green-600">{ready}</p>
                </div>
            </div>

            {/* Recent Tickets */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h2 className="font-semibold text-gray-700">Recent Tickets</h2>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                        <tr>
                            <th className="px-6 py-3 text-left">#</th>
                            <th className="px-6 py-3 text-left">Customer</th>
                            <th className="px-6 py-3 text-left">Device</th>
                            <th className="px-6 py-3 text-left">Status</th>
                            <th className="px-6 py-3 text-left">Technician</th>
                            <th className="px-6 py-3 text-left">Date</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {recentTickets.map((t) => (
                            <tr key={t.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 text-gray-400">{t.id}</td>
                                <td className="px-6 py-4 font-medium">{t.device.customer.name}</td>
                                <td className="px-6 py-4 text-gray-500">
                                    {t.device.brand} {t.device.model}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[t.status]}`}>
                                        {t.status.replace("_", " ")}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-gray-500">
                                    {t.technician?.name || "—"}
                                </td>
                                <td className="px-6 py-4 text-gray-400">
                                    {new Date(t.createdAt).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}