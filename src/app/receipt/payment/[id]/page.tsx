import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { isPaperFormat, resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { formatDateTime } from "@/shared/lib/format/formatDate";

// Format-neutral money row (renders fine at 80mm and A4 widths). `big` styles
// the grand-total line. Declared at module scope so it isn't re-created per render.
function PayRow({ label, value, big }: { label: string; value: React.ReactNode; big?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "3px 0" }}>
            <span style={{ color: "#555", fontWeight: big ? 700 : 400, fontSize: big ? 15 : undefined }}>{label}</span>
            <span style={{ textAlign: "right", fontWeight: big ? 700 : 400, fontSize: big ? 18 : undefined }}>{value}</span>
        </div>
    );
}

// Payment slip for a GL cash voucher — a RECEIPT (money collected from a party
// at the counter, the POS "Rcv" flow) or a PAYMENT (cash paid out, the "Exp"
// flow). It is the counter cash slip, so it prints thermal-first: the combined
// bridge (/print/payment) fires on mount with a browser fallback that offers
// the A4 / thermal picker — each format rendering its own template.
export default async function PaymentReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

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
    const reference = voucher.voucherNo ?? formatUvNo(voucher.id);

    // Print template (RECEIPT / PAYMENT kind) — header / address / footer.
    const template = await getVoucherTemplate(voucher.type);
    // Counter slip → thermal-first; `?paper=` override + the picker can switch.
    const format = sp.paper && isPaperFormat(sp.paper) ? sp.paper : "THERMAL_80MM";
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    // Relay payload for the thermal bridge (/print/payment). Tender breakdown =
    // the money-side ledgers; the narration carries any arrear/advance note.
    // `template` = the thermal-resolved template rides along on every job so the
    // bridge always has the shop's current config (logo/header/GSTIN toggles).
    const relayPayload = {
        reference,
        date:       voucher.date.toISOString(),
        party:      counterparty,
        tenders:    tenderLines.map((l) => ({ label: l.account.name, amount: Number(l.amount) })),
        total,
        note:       voucher.narration ?? null,
        title:      isReceipt ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER",
        partyLabel: isReceipt ? "Received from" : "Paid for",
        totalLabel: isReceipt ? "Received" : "Paid",
        template:   resolveTemplateForFormat(template, "THERMAL_80MM"),
    };

    const sample: ThermalReceiptSample = {
        reference,
        date:       formatDateTime(voucher.date),
        partyName:  counterparty,
        partyPhone: isReceipt ? partyPhone : null,
        lines:      [],
        subtotal:   null,
        taxAmount:  null,
        total:      null,
        notes:      null,
    };

    const hr = <div style={{ borderTop: "1px dashed #999", margin: "8px 0" }} />;

    const body = (
        <>
            <PayRow label="No." value={<b>{reference}</b>} />
            <PayRow label="Date" value={formatDateTime(voucher.date)} />
            {hr}
            <PayRow label={isReceipt ? "Received from" : "Paid for"} value={<b>{counterparty}</b>} />
            {isReceipt && partyPhone && <PayRow label="Phone" value={partyPhone} />}
            {isReceipt && tenderLines.length > 1 ? (
                <>
                    <PayRow label="Tenders" value="" />
                    {tenderLines.map((l, i) => (
                        <PayRow key={i} label={`· ${l.account.name}`} value={`₹${fmtAmt(Number(l.amount))}`} />
                    ))}
                </>
            ) : modeAccount ? (
                <PayRow label={isReceipt ? "Into" : "From"} value={modeAccount} />
            ) : null}
            {voucher.narration && <PayRow label="Note" value={voucher.narration} />}
            {hr}
            <PayRow label={isReceipt ? "Received" : "Paid"} value={`₹${fmtAmt(total)}`} big />
            {hr}
            {isReceipt && <div style={{ textAlign: "center", fontSize: 11 }}>Received with thanks</div>}
            <div style={{ marginTop: 24 }}>
                <div style={{ borderTop: "1px solid #000", paddingTop: 2, fontSize: 9, color: "#555" }}>
                    {template.signatureLabel}
                </div>
            </div>
        </>
    );

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            body={body}
            toolbar={
                <PrintToolbar
                    bridge={isThermal && autoPrint
                        ? { endpoint: "/print/payment", payload: relayPayload }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`${isReceipt ? "Receipt" : "Payment"} ${reference}`}
        />
    );
}
