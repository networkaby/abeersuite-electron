"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, RefreshCw, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import CampaignsHeader from "./CampaignsHeader";

type FeedState = { day: string; hash: string; builtAt: string; checkedAt: string; count: number };

const FEEDS = [
    {
        title: "Google Merchant Center",
        path: "/feeds/google.xml",
        steps: "Merchant Center → Products → Add product source → Add from file → Enter a link. Set it to fetch daily, early morning.",
        gives: "Free listings on Google Shopping and Images, and products on the Business Profile.",
    },
    {
        title: "Meta catalog (Facebook, Instagram, WhatsApp)",
        path: "/feeds/meta.csv",
        steps: "Commerce Manager → Catalog → Data sources → Data feed → Scheduled feed. Paste the link, repeat daily.",
        gives: "A shop on the Facebook Page and Instagram, product tags, and the WhatsApp Business catalog.",
    },
];

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Product Feeds — the two links to paste into Google and Meta, and how the feed
 * stands. Rebuilt at most once a day, only when the products changed; "Rebuild
 * now" is for a change the daily check cannot see.
 */
export default function ProductFeeds() {
    const [data, setData] = useState<{ state: FeedState | null; listed: number } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        axios
            .get<{ state: FeedState | null; listed: number }>("/api/campaigns/feeds")
            .then((r) => setData(r.data))
            .catch((e) => toast.error(extractApiError(e, "Failed to load the feed state")));
    }, []);

    async function rebuild() {
        setBusy(true);
        try {
            const r = await axios.post<{ state: FeedState }>("/api/campaigns/feeds");
            setData((d) => ({ listed: d?.listed ?? 0, state: r.data.state }));
            toast.success(`Feeds rebuilt — ${r.data.state.count} products`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to rebuild the feeds"));
        } finally {
            setBusy(false);
        }
    }

    const copy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
        } catch {
            toast.error("Could not copy");
        }
    };

    const s = data?.state;
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-4xl space-y-6 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={Rss}
                    title="Product Feeds"
                    description="The shop's products for Google and Meta. Paste a link once; they fetch it daily."
                    actions={
                        <Button variant="outline" onClick={rebuild} disabled={busy}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Rebuilding…" : "Rebuild now"}
                        </Button>
                    }
                />

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                        { label: "In the feed", value: s ? String(s.count) : "—", sub: data ? `of ${data.listed} listed in the shop` : "" },
                        { label: "Last built", value: s ? when(s.builtAt) : "Never", sub: "only when products changed" },
                        { label: "Last checked", value: s ? when(s.checkedAt) : "—", sub: "first fetch of the day" },
                        { label: "Rule", value: "1 / day", sub: "at most, only if changed" },
                    ].map((t) => (
                        <div key={t.label} className="rounded-xl border p-4">
                            <p className="text-xs text-muted-foreground">{t.label}</p>
                            <p className="text-lg font-semibold">{data === null ? "…" : t.value}</p>
                            <p className="text-xs text-muted-foreground">{t.sub}</p>
                        </div>
                    ))}
                </div>

                {FEEDS.map((f) => {
                    const url = `${COMPANY_DETAILS.sites.shop}${f.path}`;
                    return (
                        <section key={f.path} className="space-y-2 rounded-xl border p-4">
                            <h2 className="font-semibold">{f.title}</h2>
                            <p className="text-sm text-muted-foreground">{f.gives}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm">{url}</code>
                                <Button variant="outline" size="sm" onClick={() => copy(url)}>
                                    <Copy className="mr-1.5 h-4 w-4" /> Copy
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{f.steps}</p>
                        </section>
                    );
                })}

                <p className="text-xs text-muted-foreground">
                    Products in the feed are exactly the ones the shop shows, at its price and stock status. A product without a photo or a price is left
                    out (Google and Meta refuse it). Cost and other numbers a sale changes do not trigger a rebuild; a price or in-stock change does, once a
                    day at most. Photos are linked from Cloudinary, not copied.
                </p>
            </div>
        </ScrollArea>
    );
}
