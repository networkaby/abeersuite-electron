"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Activity, ArrowRight, Wrench } from "lucide-react";

interface TicketRow {
    id: string;
    createdAt: string;
    ticketStatus?: { label: string; color: string | null } | null;
    device?: {
        brand: string | null;
        model: string | null;
        account?: { name: string | null } | null;
    } | null;
}

function isToday(iso: string): boolean {
    const d = new Date(iso);
    const now = new Date();
    return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    );
}

/**
 * Lightweight activity feed for the Front Office. Reads /api/tickets
 * and shows the most recent 5 rows (with a "today" subset for context).
 *
 * No new endpoints — reuses the existing rich GET that already includes
 * device + customer + status in one call.
 */
export default function TodaysPulse() {
    const [tickets, setTickets] = useState<TicketRow[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        axios
            .get<TicketRow[]>("/api/tickets")
            .then((res) => {
                if (cancelled) return;
                setTickets(res.data);
                setLoaded(true);
            })
            .catch(() => {
                if (cancelled) return;
                setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const recent = tickets.slice(0, 5);
    const todayCount = tickets.filter((t) => isToday(t.createdAt)).length;

    return (
        <section>
            <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Today&apos;s pulse
                </h2>
                {loaded && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Activity size={12} />
                        {todayCount} new ticket{todayCount === 1 ? "" : "s"} today
                    </span>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
                    Latest tickets
                </div>
                {!loaded ? (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        Loading…
                    </div>
                ) : recent.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        No tickets yet. Use the &ldquo;New repair ticket&rdquo; tile
                        above to create one.
                    </div>
                ) : (
                    <ul className="divide-y divide-border">
                        {recent.map((t) => (
                            <li key={t.id}>
                                <Link
                                    href={`/office/repairing/tickets/${t.id}`}
                                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50"
                                >
                                    <Wrench
                                        size={14}
                                        className="shrink-0 text-orange-600"
                                    />
                                    <span className="font-mono text-xs">{t.id}</span>
                                    {t.ticketStatus && (
                                        <span
                                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style={{
                                                backgroundColor: t.ticketStatus.color
                                                    ? `${t.ticketStatus.color}20`
                                                    : undefined,
                                                color:
                                                    t.ticketStatus.color ?? undefined,
                                            }}
                                        >
                                            {t.ticketStatus.label}
                                        </span>
                                    )}
                                    <span className="flex-1 truncate text-muted-foreground">
                                        {t.device?.account?.name ?? "—"}
                                        {t.device?.brand
                                            ? ` · ${t.device.brand} ${t.device.model ?? ""}`
                                            : ""}
                                    </span>
                                    <ArrowRight
                                        size={12}
                                        className="shrink-0 text-muted-foreground/50"
                                    />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
