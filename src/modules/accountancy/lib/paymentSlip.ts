import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat, type VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";

/**
 * Payment slip (RECEIPT / PAYMENT GL voucher) print data — ONE builder shared by
 * the `/receipt/payment/[id]` page (format selection page) and the POS sale
 * response (silent thermal print of the overpayment Receipt voucher). Both
 * print ways must show the same slip, so both read from here.
 */
export interface PaymentSlipPrint {
    kind:      "RECEIPT" | "PAYMENT";
    reference: string;
    date:      Date;
    sample:    ThermalReceiptSample;
    /** Org-merged, NOT format-resolved — the caller resolves for its format. */
    template:  VoucherTemplateDefaults;
    /** Ready payload for the bridge `print/voucher` command (thermal-resolved). */
    relayPayload: PaymentRelayPayload;
}

export interface PaymentRelayPayload {
    kind:     "RECEIPT" | "PAYMENT";
    title:    string;
    sample:   ThermalReceiptSample;
    template: VoucherTemplateDefaults;
}

const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function buildPaymentSlipPrint(voucherId: number): Promise<PaymentSlipPrint | null> {
    // The spine IS the financial voucher. Lines (VoucherGlLine) and the party are
    // scalar/id-only, so account names + the party are enriched via lookups.
    const spine = await prisma.universalVoucher.findUnique({
        where: { id: voucherId },
        include: { lines: { orderBy: [{ type: "asc" }, { id: "asc" }] } },
    });
    if (!spine || (spine.type !== "RECEIPT" && spine.type !== "PAYMENT")) return null;

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
    const partyAccount = spine.partyAccountId != null ? (acctById.get(spine.partyAccountId) ?? null) : null;
    const lines = spine.lines.map((l) => ({ ...l, account: { name: acctById.get(l.accountId)?.name ?? "—" } }));

    const isReceipt = spine.type === "RECEIPT";
    const total = lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);

    const debitLine  = lines.find((l) => l.type === "DEBIT");
    const creditLine = lines.find((l) => l.type === "CREDIT");
    // Tender lines = the money side. RECEIPT: the debit ledgers (till / UPI / card
    // the cash landed in). A POS "collect-on-the-go" surplus posts ONE receipt with
    // several tenders, so list them all here — this voucher is where the tender
    // breakdown lives (the sale invoice no longer repeats it).
    const tenderLines = isReceipt
        ? lines.filter((l) => l.type === "DEBIT")
        : lines.filter((l) => l.type === "CREDIT");

    // RECEIPT: money INTO the debit (till), FROM the party (credit).
    // PAYMENT: money FOR the debit (expense), FROM the credit (till) — but when
    // the voucher names a party (supplier payment), "Paid to <supplier>" beats
    // the expense-ledger name.
    const owner        = partyAccount?.person ?? partyAccount?.company ?? null;
    const partyName    = owner?.name ?? partyAccount?.name ?? null;
    const partyPhone   = owner?.phones[0]?.phone ?? null;
    const counterparty = isReceipt
        ? (partyName ?? creditLine?.account.name ?? "—")
        : (partyName ?? debitLine?.account.name ?? "—");
    const reference = spine.voucherNo ?? formatUvNo(spine.id);

    // ── Party ledger balance before/after this voucher ────────────────────────
    // Only when the voucher names a party with a ledger account (walk-ins have
    // none). "After" = opening + every POSTED line on the account; "before" =
    // that minus this voucher's own effect — robust even when printed later.
    let balanceBefore: string | null = null;
    let balanceAfter:  string | null = null;
    if (spine.partyAccountId != null) {
        const acct = await prisma.account.findUnique({
            where:  { id: spine.partyAccountId },
            select: {
                normalBalance: true, openingBalance: true, openingBalanceType: true,
                group: { select: { type: true } },
            },
        });
        if (acct) {
            const nb = acct.normalBalance
                ?? (acct.group?.type ? defaultNormalBalanceForGroupType(acct.group.type) : "DEBIT");
            const allLines = await prisma.voucherGlLine.findMany({
                where:  { accountId: spine.partyAccountId, universalVoucher: ledgerStatusFilterUv() },
                select: { type: true, amount: true },
            });
            let after = allLines.reduce((bal, l) => bal + balanceDelta(nb, l.type, toNumber(l.amount)), 0);
            if (acct.openingBalance && acct.openingBalanceType) {
                after += balanceDelta(nb, acct.openingBalanceType, toNumber(acct.openingBalance));
            }
            const own = lines
                .filter((l) => l.accountId === spine.partyAccountId)
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

    const template = await getVoucherTemplate(spine.type);

    // Both formats render their built-in money middles from this sample (A4:
    // MoneyReceiptMiddle; thermal: MoneyThermalMiddle).
    const sample: ThermalReceiptSample = {
        reference,
        date:       formatDateTime(spine.date),
        partyName:  counterparty,
        partyPhone: isReceipt ? partyPhone : null,
        lines:      tenderLines.map((l) => ({ description: l.account.name, quantity: 1, amount: Number(l.amount) })),
        subtotal:   null,
        taxAmount:  null,
        total,
        notes:      spine.narration ?? null,
        balanceBefore,
        balanceAfter,
    };

    const relayPayload: PaymentRelayPayload = {
        kind:     spine.type,
        title:    template.headerLine2,
        sample,
        template: resolveTemplateForFormat(template, "THERMAL_80MM"),
    };

    return { kind: spine.type, reference, date: spine.date, sample, template, relayPayload };
}
