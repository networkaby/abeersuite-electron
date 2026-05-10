import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";

const fmtINR = (n: number) =>
    `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function PosReceiptPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
        include: {
            lines: true,
            account: {
                select: {
                    id: true,
                    person:  { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                    company: { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                },
            },
        },
    });
    if (!invoice) notFound();

    const owner = invoice.account?.person ?? invoice.account?.company ?? null;
    const partyName  = owner?.name ?? "Walk-in";
    const partyPhone = owner?.phones[0]?.phone ?? "";

    return (
        <html>
            <head>
                <title>Invoice {invoice.number}</title>
                <style>{`
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        background: #fff;
                        color: #000;
                        padding: 12px;
                    }
                    .receipt { max-width: 320px; margin: 0 auto; }
                    .center { text-align: center; }
                    .right  { text-align: right; }
                    .row    { display: flex; justify-content: space-between; }
                    .hr     { border-top: 1px dashed #000; margin: 6px 0; }
                    .lines  { width: 100%; border-collapse: collapse; }
                    .lines th, .lines td { padding: 2px 0; vertical-align: top; }
                    .lines th { font-weight: normal; border-bottom: 1px dashed #000; }
                    .lines .qty { text-align: right; width: 38px; }
                    .lines .amt { text-align: right; width: 70px; }
                    .total  { font-weight: bold; font-size: 13px; }
                    @media print {
                        .no-print { display: none !important; }
                    }
                `}</style>
            </head>
            <body>
                <div className="receipt">
                    <ReceiptButtons />

                    <div className="center" style={{ fontWeight: "bold", fontSize: 14 }}>NETWORK SHOP</div>
                    <div className="center" style={{ fontSize: 10 }}>POS sale receipt</div>
                    <div className="hr" />

                    <div className="row"><span>{invoice.number}</span><span>{invoice.issueDate.toISOString().slice(0, 10)}</span></div>
                    <div className="row"><span>Customer:</span><span>{partyName}</span></div>
                    {partyPhone && <div className="row"><span></span><span>{partyPhone}</span></div>}
                    <div className="hr" />

                    <table className="lines">
                        <thead>
                            <tr>
                                <th style={{ textAlign: "left" }}>Item</th>
                                <th className="qty">Qty</th>
                                <th className="amt">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoice.lines.map((l) => (
                                <tr key={l.id}>
                                    <td>{l.description}</td>
                                    <td className="qty">{Number(l.quantity)}</td>
                                    <td className="amt">{fmtINR(Number(l.amount))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="hr" />
                    <div className="row"><span>Subtotal</span><span>{fmtINR(Number(invoice.subtotal))}</span></div>
                    {Number(invoice.taxAmount) > 0 && (
                        <div className="row"><span>Tax</span><span>{fmtINR(Number(invoice.taxAmount))}</span></div>
                    )}
                    <div className="hr" />
                    <div className="row total"><span>Total</span><span>{fmtINR(Number(invoice.totalAmount))}</span></div>

                    {invoice.notes && (
                        <>
                            <div className="hr" />
                            <div style={{ fontSize: 10, whiteSpace: "pre-wrap" }}>{invoice.notes}</div>
                        </>
                    )}

                    <div className="hr" />
                    <div className="center" style={{ fontSize: 10 }}>Thank you · Visit again</div>
                </div>
            </body>
        </html>
    );
}
