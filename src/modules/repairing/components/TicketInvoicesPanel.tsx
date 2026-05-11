"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Receipt } from "lucide-react";

type Invoice = {
    id: number;
    number: string;
    issueDate: string;
    totalAmount: string;
    status: string;
};

export default function TicketInvoicesPanel({ ticketId }: { ticketId: number }) {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        axios
            .get(`/api/accountancy/invoices?ticketId=${ticketId}`)
            .then((res) => { if (!cancelled) setInvoices(res.data ?? []); })
            .catch(() => { if (!cancelled) setInvoices([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [ticketId]);

    return (
        <div>
            <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Receipt size={16} /> Invoices
            </h2>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices linked to this ticket yet. Create one from <Link href="/office/accountancy/sales/new" className="text-primary underline">Sales</Link> and set the ticket on the invoice.</p>
            ) : (
                <ul className="divide-y divide-border text-sm">
                    {invoices.map((inv) => (
                        <li key={inv.id} className="flex items-center justify-between py-2">
                            <Link href={`/office/accountancy/invoices/${inv.id}`} className="font-mono text-primary hover:underline">{inv.number}</Link>
                            <span className="text-muted-foreground">{new Date(inv.issueDate).toLocaleDateString()}</span>
                            <span className="font-medium">₹{Number(inv.totalAmount).toFixed(2)}</span>
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">{inv.status}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
