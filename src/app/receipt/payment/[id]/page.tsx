import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ThermalAutoPrint from "@/modules/pos/components/ThermalAutoPrint";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatDateTime } from "@/shared/lib/format/formatDate";

// Thermal (80mm) print page for a GL cash voucher — a RECEIPT (money collected
// from a party at the counter, the POS "Rcv" flow) or a PAYMENT (cash paid out,
// the POS "Exp" flow). ReceiptButtons auto-prints on mount. Opened in a new tab
// from the dialog after the voucher posts.
export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Phase 5 5E: the spine IS the financial voucher. Lines (VoucherGlLine) and the
    // party are scalar/id-only, so account names + the party are enriched via lookups
    // to keep the receipt's display shape. Total is computed from the debit legs.
    const spine = await prisma.universalVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { orderBy: [{ type: "asc" }, { id: "asc" }] } },
    });
    if (!spine || (spine.type !== "RECEIPT" && spine.type !== "PAYMENT")) notFound();

    const acctIds = [...new Set([...(spine.partyAccountId != null ? [spine.partyAccountId] : []), ...spine.lines.map((l) => l.accountId)])];
    const accounts = await prisma.account.findMany({
        where:  { id: { in: acctIds } },
        select: {
            id: true, name: true,
            person:  { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
            company: { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
        },
    });
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    const voucher = {
        ...spine,
        partyAccount: spine.partyAccountId != null ? (acctById.get(spine.partyAccountId) ?? null) : null,
        lines: spine.lines.map((l) => ({ ...l, account: { name: acctById.get(l.accountId)?.name ?? "—" } })),
    };

    const org = await getOrganisation();
    const isReceipt = voucher.type === "RECEIPT";
    const total = voucher.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);

    const debitLine  = voucher.lines.find((l) => l.type === "DEBIT");
    const creditLine = voucher.lines.find((l) => l.type === "CREDIT");
    // Tender lines = the money side. RECEIPT: the debit ledgers (till / UPI / card
    // the cash landed in). A POS "collect-on-the-go" surplus posts ONE receipt with
    // several tenders, so list them all here — this voucher is where the tender
    // breakdown lives (the sale invoice no longer repeats it).
    const tenderLines = isReceipt
        ? voucher.lines.filter((l) => l.type === "DEBIT")
        : voucher.lines.filter((l) => l.type === "CREDIT");

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

    // Relay payload for the thermal bridge (/print/payment). Tender breakdown =
    // the money-side ledgers; the narration carries any arrear/advance note.
    const relayPayload = {
        reference:  voucher.reference,
        date:       voucher.date.toISOString(),
        party:      counterparty,
        tenders:    tenderLines.map((l) => ({ label: l.account.name, amount: Number(l.amount) })),
        total,
        note:       voucher.narration ?? null,
        title:      isReceipt ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER",
        partyLabel: isReceipt ? "Received from" : "Paid for",
        totalLabel: isReceipt ? "Received" : "Paid",
    };

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
                <ThermalAutoPrint endpoint="/print/payment" payload={relayPayload} />

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
                {isReceipt && tenderLines.length > 1 ? (
                    <>
                        <div className="row"><span className="muted">Tenders</span><span className="v" /></div>
                        {tenderLines.map((l, i) => (
                            <div className="row" key={i}>
                                <span className="muted">· {l.account.name}</span>
                                <span className="v">₹{fmtAmt(Number(l.amount))}</span>
                            </div>
                        ))}
                    </>
                ) : modeAccount ? (
                    <div className="row"><span className="muted">{isReceipt ? "Into" : "From"}</span><span className="v">{modeAccount}</span></div>
                ) : null}
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
