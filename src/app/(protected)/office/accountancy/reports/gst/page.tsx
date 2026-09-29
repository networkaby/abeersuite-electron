"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, FileText, Hash, Construction, Tags } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

const SECTIONS = [
    {
        title: "Outward Supplies (Sales)",
        href: "/office/accountancy/reports/gst/outward-supplies",
        description: "GST collected on sales — broken down by tax rate (0 / 5 / 12 / 18 / 28%).",
        icon: ArrowUpRight,
    },
    {
        title: "Inward Supplies (Purchases)",
        href: "/office/accountancy/reports/gst/inward-supplies",
        description: "GST paid on purchases — input tax credit available, by tax rate.",
        icon: ArrowDownRight,
    },
    {
        title: "Net GST Liability",
        href: "/office/accountancy/reports/gst/liability",
        description: "Output tax (sales) minus input tax (purchases) — what you owe to the GST portal.",
        icon: FileText,
    },
    {
        title: "HSN / SAC Summary",
        href: "/office/accountancy/reports/gst/hsn-summary",
        description: "HSN-wise rollup of taxable value + tax — the table you copy into GSTR-1 § 12.",
        icon: Hash,
    },
    {
        title: "Tax Classification",
        href: "/office/accountancy/reports/gst/classification",
        description: "Master view — rate-wise / HSN-wise / group hierarchy / item-wise with cascade source, plus inline edit.",
        icon: Tags,
    },
];

export default function GstHubPage() {
    // Only the reports this person may open (their Compliance ticks, pageAccess.ts).
    const canOpen = useCanOpenPage();
    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-5xl mx-auto space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">GST Reports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Day-to-day GST summaries computed from voucher-line tax fields. Returns (GSTR-1, 3B) and
                    HSN-wise breakdown will arrive once GSTIN / HSN fields are added to the masters.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SECTIONS.filter((s) => canOpen(s.href)).map((s) => {
                    const Icon = s.icon;
                    return (
                        <Link
                            key={s.title}
                            href={s.href}
                            className="group rounded-lg border border-border p-5 hover:shadow-md transition-shadow"
                            // One module family instead of five unrelated hues — the icon and
                            // the title already say which return this is. Matches the reports
                            // hub one level up.
                            style={{ backgroundImage: `linear-gradient(to bottom right, ${moduleTint("accountancy", 12, "var(--card)")}, var(--card))` }}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-md bg-background border border-border p-2.5" style={{ color: moduleColor("accountancy") }}>
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
                            <li>Auto CGST/SGST/IGST split on Sales/Purchase posting (using place of supply)</li>
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
        </ScrollArea>
    );
}
