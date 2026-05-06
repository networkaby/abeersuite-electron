"use client";

import Link from "next/link";
import {
    BookOpen, BarChart2, ClipboardList, Calendar, Wallet, CreditCard, Coins, Landmark, Activity, PieChart, TrendingUp, GitBranch, Receipt,
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
    {
        title: "Receivables",
        href: "/office/tally/reports/receivables",
        description: "Open bills from Sundry Debtors, with 0–30 / 30–60 / 60–90 / 90+ ageing.",
        icon: Wallet,
        color: "from-emerald-500/10 to-emerald-500/0 text-emerald-600",
    },
    {
        title: "Payables",
        href: "/office/tally/reports/payables",
        description: "Open bills to Sundry Creditors, with the same ageing buckets.",
        icon: CreditCard,
        color: "from-rose-500/10 to-rose-500/0 text-rose-600",
    },
    {
        title: "Cash Book",
        href: "/office/tally/reports/cash-book",
        description: "Cash ledgers with opening + period movement + closing — drills into the running register.",
        icon: Coins,
        color: "from-yellow-500/10 to-yellow-500/0 text-yellow-700",
    },
    {
        title: "Bank Book",
        href: "/office/tally/reports/bank-book",
        description: "Every bank ledger with running balances — click to see its detailed register.",
        icon: Landmark,
        color: "from-cyan-500/10 to-cyan-500/0 text-cyan-700",
    },
    {
        title: "Statistics",
        href: "/office/tally/reports/statistics",
        description: "Voucher and master counts — what Tally shows on F11 stats. Cheap pulse-check on the data.",
        icon: Activity,
        color: "from-slate-500/10 to-slate-500/0 text-slate-700",
    },
    {
        title: "Ratio Analysis",
        href: "/office/tally/reports/ratio-analysis",
        description: "Current Ratio, Quick Ratio, Debt/Equity, GP%, NP%, ROI, Receivables turnover days, and more.",
        icon: PieChart,
        color: "from-violet-500/10 to-violet-500/0 text-violet-700",
    },
    {
        title: "Cash Flow",
        href: "/office/tally/reports/cash-flow",
        description: "Cash and bank inflows / outflows aggregated by counter-side ledger, with net change.",
        icon: TrendingUp,
        color: "from-teal-500/10 to-teal-500/0 text-teal-700",
    },
    {
        title: "Fund Flow",
        href: "/office/tally/reports/fund-flow",
        description: "Sources & application of funds, plus working-capital movement across the period.",
        icon: GitBranch,
        color: "from-indigo-500/10 to-indigo-500/0 text-indigo-700",
    },
    {
        title: "GST Reports",
        href: "/office/tally/reports/gst",
        description: "Output / input tax summaries by rate, net liability — the day-to-day GST view.",
        icon: Receipt,
        color: "from-pink-500/10 to-pink-500/0 text-pink-700",
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
