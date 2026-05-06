"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, FileText, Info, Construction } from "lucide-react";

const SECTIONS = [
    {
        title: "Outward Supplies (Sales)",
        href: "/office/tally/reports/gst/outward-supplies",
        description: "GST collected on sales — broken down by tax rate (0 / 5 / 12 / 18 / 28%).",
        icon: ArrowUpRight,
        color: "from-emerald-500/10 to-emerald-500/0 text-emerald-700",
    },
    {
        title: "Inward Supplies (Purchases)",
        href: "/office/tally/reports/gst/inward-supplies",
        description: "GST paid on purchases — input tax credit available, by tax rate.",
        icon: ArrowDownRight,
        color: "from-blue-500/10 to-blue-500/0 text-blue-700",
    },
    {
        title: "Net GST Liability",
        href: "/office/tally/reports/gst/liability",
        description: "Output tax (sales) minus input tax (purchases) — what you owe to the GST portal.",
        icon: FileText,
        color: "from-violet-500/10 to-violet-500/0 text-violet-700",
    },
];

export default function GstHubPage() {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">GST Reports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Day-to-day GST summaries computed from voucher-line tax fields. Returns (GSTR-1, 3B) and
                    HSN-wise breakdown will arrive once GSTIN / HSN fields are added to the masters.
                </p>
            </div>

            <div className="rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
                <div className="flex items-start gap-2 text-sm">
                    <Info size={16} className="shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" />
                    <div className="text-amber-900 dark:text-amber-200">
                        <strong>What works today:</strong> rate-wise GST summary on sales and purchases, computed from
                        the <code className="text-xs">taxRate</code> and <code className="text-xs">taxAmount</code> already on every
                        inventory-voucher line.
                        <div className="mt-1.5">
                            <strong>What needs schema additions before it&apos;ll work:</strong> party GSTIN, place of supply, item HSN /
                            SAC code, taxability flags, CGST/SGST/IGST split. Approve the migration and these come online.
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SECTIONS.map((s) => {
                    const Icon = s.icon;
                    return (
                        <Link
                            key={s.title}
                            href={s.href}
                            className={`group rounded-lg border border-border bg-gradient-to-br ${s.color} p-5 hover:shadow-md transition-shadow`}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-md bg-background border border-border p-2.5">
                                    <Icon size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-foreground group-hover:underline">{s.title}</h3>
                                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div className="rounded-lg border border-dashed border-border bg-card p-5">
                <div className="flex items-start gap-3">
                    <Construction size={18} className="shrink-0 text-muted-foreground mt-0.5" />
                    <div className="text-sm text-muted-foreground space-y-1">
                        <p><strong className="text-foreground">Roadmap (deferred):</strong></p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li>HSN / SAC summary (needs HSN field on InvProduct)</li>
                            <li>GSTR-1 export for portal upload</li>
                            <li>GSTR-3B monthly summary</li>
                            <li>GSTR-2A reconciliation against portal import</li>
                            <li>Reverse-charge (RCM) register</li>
                            <li>e-Invoice (IRN via IRP) and e-Way Bill</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
