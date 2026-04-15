import { auth } from "@/auth";

export default async function DashboardPage() {
    const session = await auth();

    return (
        <div>
            <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
            <p className="text-gray-500 mb-8">Welcome back, {session?.user?.name}!</p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Total Tickets</p>
                    <p className="text-3xl font-bold mt-1">0</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Open</p>
                    <p className="text-3xl font-bold mt-1 text-blue-600">0</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Escalated</p>
                    <p className="text-3xl font-bold mt-1 text-yellow-600">0</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-sm text-gray-500">Ready for Pickup</p>
                    <p className="text-3xl font-bold mt-1 text-green-600">0</p>
                </div>
            </div>
        </div>
    );
}