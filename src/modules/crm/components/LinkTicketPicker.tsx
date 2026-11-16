"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ExternalLink, Search, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";

type TicketOption = {
    id: number; kind: "repair" | "help" | "deal"; title: string | null; customer: string | null;
    status: string | null; createdAt: string; href: string;
};

const KIND_LABEL = { repair: "Repair", help: "Help", deal: "Deal" } as const;

/** Messages → + Ticket → "Link to an existing ticket": this customer's open
 *  tickets first; a search finds any open ticket by number, name, phone or title. */
export default function LinkTicketPicker({ phone, currentTicketId, disabled, onPick }: {
    phone: string;
    currentTicketId: number | null;
    disabled: boolean;
    onPick: (ticketId: number) => void;
}) {
    const [q, setQ] = useState("");
    const [state, setState] = useState<{ key: string; rows: TicketOption[] } | null>(null);
    const key = `${phone}|${q.trim()}`;

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            axios.get<TicketOption[]>("/api/messages/ticket-options", { params: { phone, q: q.trim() || undefined } })
                .then(({ data }) => { if (alive) setState({ key, rows: data }); })
                .catch(() => { if (alive) setState({ key, rows: [] }); });
        }, q.trim() ? 300 : 0);
        return () => { alive = false; clearTimeout(timer); };
    }, [key, phone, q]);

    const loading = state?.key !== key;
    const rows = (state?.rows ?? []).filter((t) => t.id !== currentTicketId);

    return (
        <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-medium text-foreground">Link to an existing ticket</div>
            <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Ticket no., customer name or phone"
                    className="h-8 pl-7 text-sm"
                />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
                {loading && !state && <div className="px-1 text-xs text-muted-foreground">Loading…</div>}
                {!loading && rows.length === 0 && (
                    <div className="px-1 text-xs text-muted-foreground">
                        {q.trim() ? "No open ticket matches." : "This customer has no other open ticket. Search to find one."}
                    </div>
                )}
                {rows.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-muted/70">
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onPick(t.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                            title={`Link this conversation to #${t.id}`}
                        >
                            <Ticket className="size-3.5 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-foreground">
                                    #{t.id} · {KIND_LABEL[t.kind]} · {t.title ?? "Untitled"}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {[t.customer, t.status].filter(Boolean).join(" · ")}
                                </div>
                            </div>
                        </button>
                        <a href={t.href} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary" title="Open the ticket in a new tab">
                            <ExternalLink className="size-3.5" />
                        </a>
                    </div>
                ))}
            </div>
        </div>
    );
}
