"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
    LayoutDashboard,
    Users,
    Ticket,
    Building2,
    UserCog,
    LogOut,
} from "lucide-react";

const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Tickets", href: "/tickets", icon: Ticket },
    { label: "Service Centers", href: "/service-centers", icon: Building2 },
    { label: "Users", href: "/users", icon: UserCog },
];

export default function Sidebar({ user }: { user: any }) {
    const pathname = usePathname();

    return (
        <aside className="w-64 bg-white shadow-md flex flex-col min-h-screen">
            {/* Logo */}
            <div className="p-6 border-b">
                <h1 className="text-xl font-bold text-blue-600">ServiceMgmt</h1>
                <p className="text-xs text-gray-400 mt-1">{user?.name}</p>
                <p className="text-xs text-gray-400">{user?.role}</p>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-4 space-y-1">
                {navItems.map(({ label, href, icon: Icon }) => {
                    const isActive = pathname.startsWith(href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                                    ? "bg-blue-50 text-blue-600"
                                    : "text-gray-600 hover:bg-gray-100"
                                }`}
                        >
                            <Icon size={18} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Logout */}
            <div className="p-4 border-t">
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 w-full transition-colors"
                >
                    <LogOut size={18} />
                    Sign Out
                </button>
            </div>
        </aside>
    );
}