"use client";

// Deal screen — third column. Data: GET /api/deals/[id]/customer-history
// (dealCustomerHistory.ts). Kept in memory per deal so reopening is instant;
// refreshes quietly in the background.

import { useEffect, useState } from "react";
import axios from "axios";
import {
    History, Flame, TrendingUp, Tag, Receipt, Wallet, Briefcase,
    MessagesSquare, MessageCircle, Phone, Ticket, StickyNote, Loader2,
} from "lucide-react";
import { GatedLink } from "@/shared/components/GatedLink";
import { cn } from "@/shared/lib/format/utils";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate, formatDateTime, timeAgo } from "@/shared/lib/format";
import type { DealCustomerHistory, LeadScore, CustomerTier } from "../lib/dealCustomerHistory";

const cache = new Map<number, DealCustomerHistory>();

const SCORE_STYLE: Record<LeadScore, string> = {
    Hot: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60",
    Warm: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60",
    Cold: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/60",
};
const TIER_STYLE: Record<CustomerTier, string> = {
    New: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700",
    Occasional: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60",
    Regular: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/60",
    "High-value": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
};
const COMM_META = {
    whatsapp: { icon: MessageCircle, color: "text-green-600 bg-green-50 dark:bg-green-950/40" },
    call: { icon: Phone, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
    ticket: { icon: Ticket, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
    note: { icon: StickyNote, color: "text-slate-600 bg-slate-50 dark:bg-slate-900/40" },
} as const;

const card = "rounded-xl border bg-card p-5 shadow-sm";
const sectionLabel = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function CustomerHistoryPanel({ dealId }: { dealId: number }) {
    // Result is tagged with its deal, so switching deals never shows the old one.
    const [loaded, setLoaded] = useState<{ id: number; data: DealCustomerHistory | null }>({ id: 0, data: null });

    useEffect(() => {
        let alive = true;
        axios.get<DealCustomerHistory>(`/api/deals/${dealId}/customer-history`)
            .then((r) => { cache.set(dealId, r.data); if (alive) setLoaded({ id: dealId, data: r.data }); })
            .catch(() => { if (alive) setLoaded({ id: dealId, data: null }); });
        return () => { alive = false; };
    }, [dealId]);

    const data = (loaded.id === dealId ? loaded.data : null) ?? cache.get(dealId) ?? null;
    const failed = loaded.id === dealId && !data;

    if (!data) {
        return (
            <div className={cn(card, "flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground")}>
                {failed ? "Could not load customer history." : <><Loader2 className="size-4 animate-spin" /> Loading customer history…</>}
            </div>
        );
    }

    const d = data;
    const stats = [
        { label: "Bills", value: String(d.stats.bills) },
        { label: "Spent (12 m)", value: d.stats.spent12mPaise > 0 ? formatRupeesFromPaise(d.stats.spent12mPaise) : "—" },
        { label: "Last bought", value: d.stats.lastBillAt ? timeAgo(d.stats.lastBillAt) : "—" },
        { label: "Buys every", value: d.stats.everyDays != null ? `~${d.stats.everyDays} days` : "—" },
    ];

    return (
        <div className="space-y-6">
            {/* Lead quality */}
            <div className={cn(card, "space-y-3")}>
                <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    <Flame className="size-4 text-red-500" /> Lead Quality
                </h3>
                <div className="flex items-center gap-2">
                    <span className={cn("rounded-md border px-2.5 py-1 text-sm font-bold", SCORE_STYLE[d.score])}>{d.score}</span>
                    <span className={cn("rounded-md border px-2.5 py-1 text-xs font-semibold", TIER_STYLE[d.tier])}>{d.tier} customer</span>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                    {d.reasons.map((r) => (
                        <li key={r} className="flex items-start gap-1.5"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />{r}</li>
                    ))}
                </ul>
            </div>

            {d.linked && (
                <>
                    {/* Communication */}
                    <div className={cn(card, "space-y-3")}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                                <MessagesSquare className="size-4 text-teal-600" /> Communication
                            </h3>
                            <span className="text-[11px] text-muted-foreground">
                                Last contact: <strong className="text-foreground">{d.comms.lastContactAt ? timeAgo(d.comms.lastContactAt) : "—"}</strong>
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {[
                                { label: "WhatsApp", value: d.comms.counts.whatsapp, icon: MessageCircle, cls: "text-green-600" },
                                { label: "Calls", value: d.comms.counts.calls, icon: Phone, cls: "text-blue-600" },
                                { label: "Tickets", value: d.comms.counts.tickets, icon: Ticket, cls: "text-amber-600" },
                            ].map((s) => (
                                <div key={s.label} className="rounded-lg border bg-muted/30 py-2">
                                    <s.icon className={cn("mx-auto size-4", s.cls)} />
                                    <div className="text-sm font-bold tabular-nums">{s.value}</div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
                                </div>
                            ))}
                        </div>
                        {d.comms.recent.length === 0 ? (
                            <p className="text-xs italic text-muted-foreground">No calls or messages yet.</p>
                        ) : (
                            <ul className="space-y-2.5 border-l pl-3 ml-1.5">
                                {d.comms.recent.map((c) => {
                                    const { icon: Icon, color } = COMM_META[c.kind];
                                    return (
                                        <li key={c.key} className="relative text-xs">
                                            <span className={cn("absolute -left-[22px] top-0 flex size-5 items-center justify-center rounded-full border bg-card", color, c.missed && "text-red-600")}>
                                                <Icon className="size-3" />
                                            </span>
                                            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                                <span className={cn("font-medium truncate", c.missed && "text-red-600")}>{c.title}</span>
                                                <span className="whitespace-nowrap">{formatDateTime(c.at)}</span>
                                            </div>
                                            {c.detail && <p className="text-foreground leading-snug line-clamp-2">{c.detail}</p>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {/* Customer history */}
                    <div className={cn(card, "space-y-4")}>
                        <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                            <History className="size-4 text-blue-600" /> Customer History
                        </h3>

                        <div className="grid grid-cols-2 gap-2">
                            {stats.map((s) => (
                                <div key={s.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
                                    <div className="text-sm font-bold tabular-nums text-foreground">{s.value}</div>
                                </div>
                            ))}
                        </div>

                        {d.duePaise !== 0 && (
                            <div className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-xs",
                                d.duePaise > 0
                                    ? "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300")}>
                                <span className="flex items-center gap-1.5 font-medium"><Wallet className="size-3.5" /> {d.duePaise > 0 ? "Due with us" : "Advance with us"}</span>
                                <span className="font-bold tabular-nums">{formatRupeesFromPaise(Math.abs(d.duePaise))}</span>
                            </div>
                        )}

                        {/* Price suggestion */}
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40 p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                                <Tag className="size-3.5" /> Price Suggestion
                            </div>
                            <p className="text-xs text-emerald-900 dark:text-emerald-200">{d.suggestion}</p>
                            {d.avgDiscountPct != null && (
                                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">Usual discount on past bills: <strong>{d.avgDiscountPct}%</strong></p>
                            )}
                        </div>

                        {/* Recent purchases */}
                        <div className="space-y-2">
                            <div className={sectionLabel}><Receipt className="size-3.5" /> Recent Purchases</div>
                            {d.purchases.length === 0 ? (
                                <p className="text-xs italic text-muted-foreground">No purchases yet.</p>
                            ) : (
                                <ul className="divide-y rounded-lg border">
                                    {d.purchases.map((p) => (
                                        <li key={p.key} className={cn("px-3 py-2 text-xs", p.match && "bg-blue-50/70 dark:bg-blue-950/30")}>
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="font-medium text-foreground leading-snug">{p.item}</span>
                                                <span className="font-semibold tabular-nums whitespace-nowrap">{formatRupeesFromPaise(p.ratePaise)}</span>
                                            </div>
                                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                                <span>
                                                    {formatDate(p.at)} · Qty {p.qty}
                                                    {p.match && <span className="ml-1.5 rounded bg-blue-100 dark:bg-blue-900/50 px-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300">Same kind</span>}
                                                </span>
                                                {p.billNo && (p.href
                                                    ? <GatedLink href={p.href} className="text-blue-600 hover:underline">{p.billNo}</GatedLink>
                                                    : <span>{p.billNo}</span>)}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Other deals */}
                        {d.deals.length > 0 && (
                            <div className="space-y-2">
                                <div className={sectionLabel}><Briefcase className="size-3.5" /> Other Deals</div>
                                <ul className="space-y-1.5">
                                    {d.deals.map((x) => (
                                        <li key={x.id} className="flex items-center justify-between gap-2 text-xs">
                                            <span className="text-foreground truncate">{x.title} <span className="text-muted-foreground">· {formatDate(x.at)}</span></span>
                                            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                                                /won/i.test(x.status) ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                                    : /lost/i.test(x.status) ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                                        : "bg-muted text-muted-foreground")}>
                                                {x.status || "Open"}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {d.topCategories.length > 0 && (
                            <div className="flex items-center gap-1.5 border-t pt-3 text-[11px] text-muted-foreground">
                                <TrendingUp className="size-3.5" /> Mostly buys: {d.topCategories.join(", ")}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
