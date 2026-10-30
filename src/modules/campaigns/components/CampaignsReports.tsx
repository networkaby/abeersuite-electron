"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ChartNoAxesCombined } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { POST_CHANNELS } from "@/modules/campaigns/lib/post";
import type { CampaignStats } from "@/modules/campaigns/lib/sendCampaign";
import CampaignsHeader from "./CampaignsHeader";

type Report = {
    days: number;
    channels: Record<string, { auto: number; byHand: number }>;
    campaigns: {
        id: number;
        name: string;
        sentAt: string;
        coupon: string | null;
        stats: CampaignStats;
        couponUse: { uses: number; discount: number } | null;
    }[];
};

// Kept across visits in this tab, so coming back shows the last numbers while they refresh.
let cached: Report | null = null;

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const date = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** What posts and campaigns did in the last 30 days, from our own records only. */
export default function CampaignsReports() {
    const [data, setData] = useState<Report | null>(cached);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        axios
            .get<Report>("/api/campaigns/reports")
            .then((r) => setData((cached = r.data)))
            .catch(() => setFailed(true));
    }, []);

    const days = data?.days ?? 30;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-4 pb-10">
                <CampaignsHeader icon={ChartNoAxesCombined} title="Reports" description={`What posts and campaigns did in the last ${days} days.`} />
                {failed && !data && <p className="text-sm text-destructive">Could not load the report — refresh to try again.</p>}

                <section className="rounded-xl border">
                    <div className="border-b px-4 py-3">
                        <h2 className="text-sm font-semibold">Posts put up, by channel</h2>
                        <p className="text-xs text-muted-foreground">Automatic = posted by itself; by hand = staff pressed Done.</p>
                    </div>
                    <div className="divide-y">
                        {POST_CHANNELS.map((c) => {
                            const row = data?.channels[c.value];
                            return (
                                <div key={c.value} className="flex items-center justify-between gap-3 px-4 py-2.5">
                                    <p className="text-sm">{c.label}</p>
                                    <span className="text-xs text-muted-foreground">
                                        {!data ? "…" : !row ? "—" : [row.auto && `${row.auto} automatic`, row.byHand && `${row.byHand} by hand`].filter(Boolean).join(" · ")}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="rounded-xl border">
                    <div className="border-b px-4 py-3">
                        <h2 className="text-sm font-semibold">Campaigns sent</h2>
                        <p className="text-xs text-muted-foreground">
                            App notification results. Coupon use is every bill with that coupon in the {days} days, not only from the campaign.
                        </p>
                    </div>
                    {data && data.campaigns.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No campaign sent in the last {days} days.</p>}
                    {!data && <p className="px-4 py-3 text-sm text-muted-foreground">…</p>}
                    {data && data.campaigns.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-xs text-muted-foreground">
                                    <tr className="border-b">
                                        <th className="px-4 py-2 text-left font-medium">Campaign</th>
                                        <th className="px-2 py-2 text-right font-medium">Messaged</th>
                                        <th className="px-2 py-2 text-right font-medium">Reached</th>
                                        <th className="px-2 py-2 text-right font-medium">Shown</th>
                                        <th className="px-2 py-2 text-right font-medium">Tapped</th>
                                        <th className="px-4 py-2 text-right font-medium">Coupon used</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {data.campaigns.map((c) => (
                                        <tr key={c.id}>
                                            <td className="px-4 py-2.5">
                                                <p>{c.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {date(c.sentAt)}
                                                    {c.coupon && ` · ${c.coupon}`}
                                                </p>
                                            </td>
                                            <td className="px-2 py-2.5 text-right tabular-nums">{c.stats.customers}</td>
                                            <td className="px-2 py-2.5 text-right tabular-nums">{c.stats.reached}</td>
                                            <td className="px-2 py-2.5 text-right tabular-nums">{c.stats.shown}</td>
                                            <td className="px-2 py-2.5 text-right tabular-nums">{c.stats.tapped}</td>
                                            <td className="px-4 py-2.5 text-right tabular-nums">
                                                {c.couponUse ? `${c.couponUse.uses} · ${rupees(c.couponUse.discount)} off` : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </ScrollArea>
    );
}
