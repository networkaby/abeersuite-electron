"use client";

import Link from "next/link";
import {
    BookOpen, BarChart2, ClipboardList, Calendar,
} from "lucide-react";

const REPORTS = [
    {
        title: "Balance Sheet",
        href: "/office/tally/reports/balance-sheet",
        description: "Liabilities & Assets as on a date — fully drill-down to source vouchers.",
        icon: BarChart2,
        color: "from-blue-500/10 to-blue-500/0 text-blue-600",
    },
    {
        title: "Profit & Loss A/c",
        href: "/office/tally/reports/profit-loss",
        description: "Trading + P&L for a period, with opening / closing stock.",
        icon: BookOpen,
        color: "from-green-500/10 to-green-500/0 text-green-600",
    },
    {
        title: "Trial Balance",
        href: "/office/tally/reports/trial-balance",
        description: "Opening + transactions Dr/Cr + closing per ledger, group-hierarchical.",
        icon: ClipboardList,
        color: "from-purple-500/10 to-purple-500/0 text-purple-600",
    },
    {
        title: "Day Book",
        href: "/office/tally/reports/day-book",
        description: "All posted vouchers in chronological order, jump-to-source.",
        icon: Calendar,
        color: "from-orange-500/10 to-orange-500/0 text-orange-600",
    },
];

export default function ReportsMenuPage() {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Financial Reports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Statutory and management reports — every row drills down to its source.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {REPORTS.map((r) => {
                    const Icon = r.icon;
                    return (
                        <Link
                            key={r.title}
                            href={r.href}
                            className={`group rounded-lg border border-border bg-gradient-to-br ${r.color} p-5 hover:shadow-md transition-shadow`}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-md bg-background border border-border p-2.5">
                                    <Icon size={20} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-foreground group-hover:underline">{r.title}</h3>
                                    <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
