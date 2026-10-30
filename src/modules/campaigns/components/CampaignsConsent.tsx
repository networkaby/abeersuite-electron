"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { BellOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import CampaignsHeader from "./CampaignsHeader";

type Consent = {
    emails: { email: string; createdAt: string }[];
    emailTotal: number;
    pageSize: number;
    push: { customers: number; devices: number };
    canEdit: boolean;
};

const date = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Who said no to marketing, from what we actually record. */
export default function CampaignsConsent() {
    const [q, setQ] = useState("");
    const [page, setPage] = useState(0);
    const [data, setData] = useState<Consent | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        // Typing waits a moment so each keystroke is not a request.
        const t = setTimeout(() => {
            axios
                .get<Consent>("/api/campaigns/consent", { params: { q: q || undefined, page } })
                .then((r) => setData(r.data))
                .catch((e) => toast.error(extractApiError(e, "Could not load consent")));
        }, 300);
        return () => clearTimeout(t);
    }, [q, page, reload]);

    async function resubscribe(email: string) {
        if (!window.confirm(`Send offer emails to ${email} again? Do this only if the customer asked.`)) return;
        const before = data;
        // Optimistic: drop the row now, put it back if the server refuses.
        setData((d) => d && { ...d, emails: d.emails.filter((x) => x.email !== email), emailTotal: d.emailTotal - 1 });
        try {
            await axios.delete("/api/campaigns/consent", { params: { email } });
            toast.success(`${email} will get offer emails again`);
            setReload((n) => n + 1);
        } catch (e) {
            setData(before);
            toast.error(extractApiError(e, "Could not re-subscribe"));
        }
    }

    const pages = data ? Math.max(1, Math.ceil(data.emailTotal / data.pageSize)) : 1;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-4 pb-10">
                <CampaignsHeader icon={BellOff} title="Consent" description="Who said no to marketing. Bills and service messages always go." />

                <div className="grid gap-4 md:grid-cols-2">
                    <section className="rounded-xl border px-4 py-3">
                        <h2 className="text-sm font-semibold">App notifications on</h2>
                        <p className="text-2xl font-semibold">{data ? data.push.customers : "…"}</p>
                        <p className="text-xs text-muted-foreground">
                            customers{data && ` · ${data.push.devices} devices`} — the phone holds the yes or no; a campaign reaches exactly these.
                        </p>
                    </section>
                    <section className="rounded-xl border px-4 py-3">
                        <h2 className="text-sm font-semibold">Always allowed</h2>
                        <p className="text-xs text-muted-foreground">
                            Bills, receipts, repair updates and due reminders are not marketing, so an opt-out does not stop them. Customers who
                            should never get a due reminder are on the{" "}
                            <Link href="/office/campaigns/due-reminders" className="underline">
                                Due Reminders
                            </Link>{" "}
                            page.
                        </p>
                    </section>
                </div>

                <section className="rounded-xl border">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                        <div>
                            <h2 className="text-sm font-semibold">Email unsubscribed{data && ` · ${data.emailTotal}`}</h2>
                            <p className="text-xs text-muted-foreground">Pressed the unsubscribe link in an offer email. No offer emails go to these.</p>
                        </div>
                        <Input
                            value={q}
                            onChange={(e) => {
                                setQ(e.target.value);
                                setPage(0);
                            }}
                            placeholder="Search email"
                            className="h-8 w-56"
                        />
                    </div>
                    {!data && <p className="px-4 py-3 text-sm text-muted-foreground">…</p>}
                    {data && data.emails.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">{q ? "No address matches." : "Nobody has unsubscribed."}</p>
                    )}
                    <div className="divide-y">
                        {data?.emails.map((e) => (
                            <div key={e.email} className="flex items-center justify-between gap-3 px-4 py-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm">{e.email}</p>
                                    <p className="text-xs text-muted-foreground">since {date(e.createdAt)}</p>
                                </div>
                                {data.canEdit && (
                                    <Button size="sm" variant="outline" onClick={() => resubscribe(e.email)}>
                                        Re-subscribe
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                    {pages > 1 && (
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
                            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                                Previous
                            </Button>
                            {page + 1} / {pages}
                            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                                Next
                            </Button>
                        </div>
                    )}
                </section>
            </div>
        </ScrollArea>
    );
}
