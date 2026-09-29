"use client";

import Link from "next/link";
import {
    BookOpen, BarChart2, ClipboardList, Calendar, Wallet, CreditCard, Coins, Landmark, Activity, PieChart, TrendingUp, GitBranch, Receipt,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

const REPORTS = [
    {
        title: "Balance Sheet",
        href: "/office/accountancy/reports/balance-sheet",
        description: "Liabilities & Assets as on a date — fully drill-down to source vouchers.",
        icon: BarChart2,
    },
    {
        title: "Profit & Loss A/c",
        href: "/office/accountancy/reports/profit-loss",
        description: "Trading + P&L for a period, with opening / closing stock.",
        icon: BookOpen,
    },
    {
        title: "Trial Balance",
        href: "/office/accountancy/reports/trial-balance",
        description: "Opening + transactions Dr/Cr + closing per ledger, group-hierarchical.",
        icon: ClipboardList,
    },
    {
        title: "Day Book",
        href: "/office/accountancy/reports/day-book",
        description: "All posted vouchers in chronological order, jump-to-source.",
        icon: Calendar,
    },
    {
        title: "Receivables",
        href: "/office/accountancy/reports/receivables",
        description: "Open bills from Sundry Debtors, with 0–30 / 30–60 / 60–90 / 90+ ageing.",
        icon: Wallet,
    },
    {
        title: "Payables",
        href: "/office/accountancy/reports/payables",
        description: "Open bills to Sundry Creditors, with the same ageing buckets.",
        icon: CreditCard,
    },
    {
        title: "Cash Book",
        href: "/office/accountancy/reports/cash-book",
        description: "Cash ledgers with opening + period movement + closing — drills into the running register.",
        icon: Coins,
    },
    {
        title: "Bank Book",
        href: "/office/accountancy/reports/bank-book",
        description: "Every bank ledger with running balances — click to see its detailed register.",
        icon: Landmark,
    },
    {
        title: "Statistics",
        href: "/office/accountancy/reports/statistics",
        description: "Voucher and master counts — what Tally shows on F11 stats. Cheap pulse-check on the data.",
        icon: Activity,
    },
    {
        title: "Ratio Analysis",
        href: "/office/accountancy/reports/ratio-analysis",
        description: "Current Ratio, Quick Ratio, Debt/Equity, GP%, NP%, ROI, Receivables turnover days, and more.",
        icon: PieChart,
    },
    {
        title: "Cash Flow",
        href: "/office/accountancy/reports/cash-flow",
        description: "Cash and bank inflows / outflows aggregated by counter-side ledger, with net change.",
        icon: TrendingUp,
    },
    {
        title: "Fund Flow",
        href: "/office/accountancy/reports/fund-flow",
        description: "Sources & application of funds, plus working-capital movement across the period.",
        icon: GitBranch,
    },
    {
        title: "GST Reports",
        href: "/office/accountancy/reports/gst",
        description: "Output / input tax summaries by rate, net liability — the day-to-day GST view.",
        icon: Receipt,
    },
];

export default function ReportsMenuPage() {
    // Only the reports this person may open (the page lock, pageAccess.ts).
    const canOpen = useCanOpenPage();
    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Financial Reports</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Statutory and management reports — every row drills down to its source.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {REPORTS.filter((r) => canOpen(r.href)).map((r) => {
                        const Icon = r.icon;
                        return (
                            <Link
                                key={r.title}
                                href={r.href}
                                className="group rounded-lg border border-border p-5 hover:shadow-md transition-shadow"
                                // Thirteen hand-picked hues used to make this page read as a box
                                // of crayons, and none of them meant anything — the icon and the
                                // title already say which report this is. One module family
                                // instead, and the tint fades to the card so the wash behind it
                                // still reads.
                                style={{ backgroundImage: `linear-gradient(to bottom right, ${moduleTint("accountancy", 12, "var(--card)")}, var(--card))` }}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="rounded-md bg-background border border-border p-2.5" style={{ color: moduleColor("accountancy") }}>
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
        </ScrollArea>
    );
}
