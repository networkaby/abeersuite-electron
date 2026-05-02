"use client";

import { Button } from "@/components/ui/button";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";

type Line = {
    id: number;
    quantity: number;
    unitPricePaise: number;
    product: { name: string };
};

export default function OrderInvoice({
    orderId,
    createdAt,
    status,
    lines,
    totalPaise,
    guestEmail,
    guestPhone,
    customerName,
}: {
    orderId: number;
    createdAt: string;
    status: string;
    lines: Line[];
    totalPaise: number;
    guestEmail: string | null;
    guestPhone: string | null;
    customerName: string | null;
}) {
    const print = () => {
        window.print();
    };

    return (
        <div className="space-y-3">
            <Button type="button" variant="outline" size="sm" onClick={print} className="print:hidden">
                Print invoice
            </Button>
            <div
                id={`invoice-${orderId}`}
                className="rounded-lg border border-border bg-card p-6 text-sm print:border-0 print:shadow-none"
            >
                <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-4">
                    <div>
                        <p className="text-lg font-bold">{COMPANY_DETAILS.brandName}</p>
                        <p className="text-muted-foreground text-xs">{COMPANY_DETAILS.tax.gstin}</p>
                        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                            {COMPANY_DETAILS.address.line1}, {COMPANY_DETAILS.address.city},{" "}
                            {COMPANY_DETAILS.address.state} {COMPANY_DETAILS.address.pin}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="font-semibold">Tax invoice</p>
                        <p>Order #{orderId}</p>
                        <p className="text-muted-foreground">{new Date(createdAt).toLocaleString("en-IN")}</p>
                        <p className="mt-1">
                            Status: <span className="font-medium">{status}</span>
                        </p>
                    </div>
                </div>
                <div className="py-4">
                    <p className="font-medium">Bill to</p>
                    <p className="text-muted-foreground">
                        {customerName ?? "Guest"}{" "}
                        {guestEmail ? `· ${guestEmail}` : ""} {guestPhone ? `· ${guestPhone}` : ""}
                    </p>
                </div>
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-border">
                            <th className="py-2">Item</th>
                            <th className="py-2 text-right">Qty</th>
                            <th className="py-2 text-right">Rate</th>
                            <th className="py-2 text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map((l) => (
                            <tr key={l.id} className="border-b border-border/60">
                                <td className="py-2">{l.product.name}</td>
                                <td className="py-2 text-right">{l.quantity}</td>
                                <td className="py-2 text-right">{formatRupeesFromPaise(l.unitPricePaise)}</td>
                                <td className="py-2 text-right">
                                    {formatRupeesFromPaise(l.unitPricePaise * l.quantity)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="mt-4 flex justify-end border-t border-border pt-4">
                    <p className="text-base font-semibold">Total: {formatRupeesFromPaise(totalPaise)}</p>
                </div>
                <p className="mt-6 text-center text-xs text-muted-foreground">
                    Amounts in {COMPANY_DETAILS.currencyCode} · Thank you for shopping with {COMPANY_DETAILS.brandName}
                </p>
            </div>
        </div>
    );
}
