"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";

// Reads InvVoucher rows linked to this ticket. The legacy Invoice/ticketId
// path was retired with the Invoice → InvVoucher consolidation (Layer 3c,
// 2026-05-24); the panel now consumes /api/inventory/vouchers with the
// new `ticketId` query filter and renders any of SALE / POS / SALE_RETURN
// that the operator linked to the ticket.
type InvVoucher = {
    id:          number;
    reference:   string;
    type:        string;
    status:      string;
    date:        string;
    totalAmount: string;
};

export default function TicketInvoicesPanel({ ticketId }: { ticketId: number }) {
    const [vouchers, setVouchers] = useState<InvVoucher[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        axios
            .get<InvVoucher[]>(`/api/inventory/vouchers?ticketId=${ticketId}&types=SALE,POS,SALE_RETURN`)
            .then((res) => { if (!cancelled) setVouchers(res.data ?? []); })
            .catch(() => { if (!cancelled) setVouchers([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [ticketId]);

    // Hide the whole card until there is at least one linked invoice (also while
    // loading) — no empty-state clutter on tickets that were never billed.
    if (loading || vouchers.length === 0) return null;

    return (
        <div className="rounded-lg border border-border bg-card p-4 shadow">
            <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Receipt size={16} /> Invoices
            </h2>
            <ul className="divide-y divide-border text-sm">
                {vouchers.map((v) => {
                    const href = editFormUrl(v.type, v.id);
                    return (
                        <li key={v.id} className="flex items-center justify-between py-2">
                            {href ? (
                                <Link href={href} className="font-mono text-primary hover:underline">{v.reference}</Link>
                            ) : (
                                <span className="font-mono text-muted-foreground">{v.reference}</span>
                            )}
                            <span className="text-muted-foreground">{new Date(v.date).toLocaleDateString()}</span>
                            <span className="font-medium">₹{Number(v.totalAmount).toFixed(2)}</span>
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">{v.status}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
