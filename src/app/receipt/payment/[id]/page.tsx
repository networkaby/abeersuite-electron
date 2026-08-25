import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { isPaperFormat, resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

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
    await requireStaffPage();

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
    // PAYMENT: money FOR the debit (expense), FROM the credit (till) — but when
    // the voucher names a party (supplier payment), "Paid to <supplier>" beats
    // the expense-ledger name.
    const owner       = voucher.partyAccount?.person ?? voucher.partyAccount?.company ?? null;
    const partyName   = owner?.name ?? voucher.partyAccount?.name ?? null;
    const partyPhone  = owner?.phones[0]?.phone ?? null;
    const counterparty = isReceipt
        ? (partyName ?? creditLine?.account.name ?? "—")
        : (partyName ?? debitLine?.account.name ?? "—");
    const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const reference = voucher.voucherNo ?? formatUvNo(voucher.id);

    // ── Party ledger balance before/after this voucher ────────────────────────
    // Only when the voucher names a party with a ledger account (walk-ins have
    // none). "After" = opening + every POSTED line on the account; "before" =
    // that minus this voucher's own effect — robust even when printed later.
    let balanceBefore: string | null = null;
    let balanceAfter:  string | null = null;
    if (voucher.partyAccountId != null) {
        const acct = await prisma.account.findUnique({
            where:  { id: voucher.partyAccountId },
            select: {
                normalBalance: true, openingBalance: true, openingBalanceType: true,
                group: { select: { type: true } },
            },
        });
        if (acct) {
            const nb = acct.normalBalance
                ?? (acct.group?.type ? defaultNormalBalanceForGroupType(acct.group.type) : "DEBIT");
            const allLines = await prisma.voucherGlLine.findMany({
                where:  { accountId: voucher.partyAccountId, universalVoucher: ledgerStatusFilterUv() },
                select: { type: true, amount: true },
            });
            let after = allLines.reduce((bal, l) => bal + balanceDelta(nb, l.type, toNumber(l.amount)), 0);
            if (acct.openingBalance && acct.openingBalanceType) {
                after += balanceDelta(nb, acct.openingBalanceType, toNumber(acct.openingBalance));
            }
            const own = voucher.lines
                .filter((l) => l.accountId === voucher.partyAccountId)
                .reduce((bal, l) => bal + balanceDelta(nb, l.type, toNumber(l.amount)), 0);
            const before = after - own;
            // Positive = the account's normal side (customer Dr / supplier Cr).
            const fmtBal = (n: number) => {
                const side = n >= 0
                    ? (nb === "DEBIT" ? "Dr" : "Cr")
                    : (nb === "DEBIT" ? "Cr" : "Dr");
                return `Rs. ${fmtAmt(Math.abs(n))} ${side}`;
            };
            balanceBefore = fmtBal(before);
            balanceAfter  = fmtBal(after);
        }
    }

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

    // A4 renders the receipt-book middle (MoneyReceiptMiddle) from this sample:
    // tender lines → "by ___", narration → "towards ___", total → boxed amount.
    const sample: ThermalReceiptSample = {
        reference,
        date:       formatDateTime(voucher.date),
        partyName:  counterparty,
        partyPhone: isReceipt ? partyPhone : null,
        lines:      tenderLines.map((l) => ({ description: l.account.name, quantity: 1, amount: Number(l.amount) })),
        subtotal:   null,
        taxAmount:  null,
        total,
        notes:      voucher.narration ?? null,
        balanceBefore,
        balanceAfter,
    };

    // No bespoke body — both formats render their built-in money middles from
    // `sample` (A4: MoneyReceiptMiddle receipt-book prose; thermal:
    // MoneyThermalMiddle cash slip), so preview and real print stay identical.
    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
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
