import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatDateTime } from "@/shared/lib/format/formatDate";

// Thermal (80mm) print page for a GL cash voucher — a RECEIPT (money collected
// from a party at the counter, the POS "Rcv" flow) or a PAYMENT (cash paid out,
// the POS "Exp" flow). ReceiptButtons auto-prints on mount. Opened in a new tab
// from the dialog after the voucher posts.
export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { name: true } } } },
            partyAccount: {
                select: {
                    name:    true,
                    person:  { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                    company: { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                },
            },
        },
    });
    if (!voucher || (voucher.type !== "RECEIPT" && voucher.type !== "PAYMENT")) notFound();

    const org = await getOrganisation();
    const isReceipt = voucher.type === "RECEIPT";
    const total = Number(voucher.totalAmount);

    const debitLine  = voucher.lines.find((l) => l.type === "DEBIT");
    const creditLine = voucher.lines.find((l) => l.type === "CREDIT");

    // RECEIPT: money INTO the debit (till), FROM the party (credit).
    // PAYMENT: money FOR the debit (expense), FROM the credit (till).
    const owner       = voucher.partyAccount?.person ?? voucher.partyAccount?.company ?? null;
    const partyName   = owner?.name ?? voucher.partyAccount?.name ?? null;
    const partyPhone  = owner?.phones[0]?.phone ?? null;
    const counterparty = isReceipt
        ? (partyName ?? creditLine?.account.name ?? "—")
        : (debitLine?.account.name ?? "—");
    const modeAccount  = isReceipt ? debitLine?.account.name : creditLine?.account.name;
    const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <html>
            <head>
                <title>{isReceipt ? "Receipt" : "Payment"} {voucher.reference}</title>
                <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 4mm; background: #fff; color: #000; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .large { font-size: 16px; }
          .xl { font-size: 19px; }
          .small { font-size: 10px; }
          .muted { color: #555; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
          .row .v { text-align: right; }
          .signature-line { border-top: 1px solid #000; margin-top: 22px; padding-top: 2px; font-size: 9px; color: #555; }
          @media print { .no-print { display: none !important; } body { margin: 0; padding: 2mm; } }
        `}</style>
            </head>
            <body>
                <ReceiptButtons />

                <div className="center">
                    <div className="bold large">{org.brandName}</div>
                    <div className="small muted">{isReceipt ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER"}</div>
                </div>

                <div className="divider" />

                <div className="row"><span className="muted">No.</span><span className="v bold">{voucher.reference}</span></div>
                <div className="row"><span className="muted">Date</span><span className="v">{formatDateTime(voucher.date)}</span></div>

                <div className="divider" />

                <div className="row">
                    <span className="muted">{isReceipt ? "Received from" : "Paid for"}</span>
                    <span className="v bold">{counterparty}</span>
                </div>
                {isReceipt && partyPhone && (
                    <div className="row"><span className="muted">Phone</span><span className="v">{partyPhone}</span></div>
                )}
                {modeAccount && (
                    <div className="row"><span className="muted">{isReceipt ? "Into" : "From"}</span><span className="v">{modeAccount}</span></div>
                )}
                {voucher.narration && (
                    <div className="row"><span className="muted">Note</span><span className="v">{voucher.narration}</span></div>
                )}

                <div className="divider" />

                <div className="row">
                    <span className="bold large">{isReceipt ? "Received" : "Paid"}</span>
                    <span className="v bold xl">₹{fmtAmt(total)}</span>
                </div>

                <div className="divider" />

                {isReceipt && <div className="center small">Received with thanks</div>}

                <div style={{ marginTop: "24px" }}>
                    <div className="signature-line">Authorised Signature</div>
                </div>

                <div className="divider" />
                <div className="center small muted">{org.brandName}{org.phone ? ` · ${org.phone}` : ""}</div>
            </body>
        </html>
    );
}
