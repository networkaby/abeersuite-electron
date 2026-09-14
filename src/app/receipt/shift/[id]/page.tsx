import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { ShiftCloseBody, type ShiftCloseBodyData } from "@/shared/components/print/ShiftCloseBody";
import { requireStaffPage } from "@/shared/lib/auth/permissions";
import { EFFECTIVE_BALANCE_SELECT_FIELDS } from "@/modules/accountancy/lib/balance";
import {
    sumPaise,
    effectiveBalancePaise,
    computeExpectedCash,
    buildShiftMovementBreakdown,
    buildShiftTenderBreakdown,
    buildShiftCollectionsBreakdown,
} from "@/modules/pos/lib/shiftMath";

// Shift Close & Cash Reconciliation Print Page.
//
// Prints the shift closing report through the central template-driven renderer
// (SHIFT_CLOSE kind). Follows house print rules: thermal fires the combined
// bridge (or silent print) when mode=thermal, or stays open with format picker
// (A4 / 80mm roll).
export default async function ShiftReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string; mode?: string }>;
}) {
    await requireStaffPage();

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) notFound();

    const sp = (await searchParams) ?? {};

    const shift = await prisma.posShift.findUnique({
        where: { id: shiftId },
        include: {
            user:    { select: { id: true, name: true, email: true } },
            branch:  { select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, state: true, pinCode: true } },
            counter: {
                include: {
                    tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
                    paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } },
                },
            },
            openedBy: { select: { id: true, name: true } },
            closedBy: { select: { id: true, name: true } },
            drops: {
                orderBy: { droppedAt: "desc" },
                include: { droppedBy: { select: { id: true, name: true } } },
            },
        },
    });

    if (!shift) notFound();

    const template = await getVoucherTemplate("SHIFT_CLOSE");
    const format = resolvePaperFormat(template, sp.paper, sp.mode);
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    const dropsPaise = sumPaise(shift.drops);

    const tillBookBalancePaise = (shift.status === "CLOSED" && shift.expectedCashPaise != null)
        ? shift.expectedCashPaise + dropsPaise
        : effectiveBalancePaise(shift.counter.tillAccount);

    const movementBreakdown = await buildShiftMovementBreakdown(prisma, {
        shiftId: shift.id,
        tillAccountId: shift.counter.tillAccount.id,
        tillBookBalancePaise,
        openingFloatPaise: shift.openingFloatPaise,
    });
    const tenderBreakdown = await buildShiftTenderBreakdown(prisma, {
        shiftId: shift.id,
        counter: shift.counter,
        paymentAccounts: shift.counter.paymentAccounts,
    });
    const collectionsBreakdown = await buildShiftCollectionsBreakdown(prisma, {
        shiftId: shift.id,
        counter: shift.counter,
    });

    const [closingContra, varianceJE] = await Promise.all([
        shift.closingContraVoucherId != null
            ? prisma.universalVoucher.findUnique({ where: { id: shift.closingContraVoucherId }, select: { id: true, voucherNo: true } })
                .then((c) => c ? { reference: c.voucherNo ?? formatUvNo(c.id) } : null)
            : Promise.resolve(null),
        shift.varianceJournalEntryId != null
            ? prisma.universalVoucher.findUnique({ where: { id: shift.varianceJournalEntryId }, select: { id: true, voucherNo: true } })
                .then((j) => j ? { reference: j.voucherNo ?? formatUvNo(j.id) } : null)
            : Promise.resolve(null),
    ]);

    const openedAt = new Date(shift.openedAt);
    const closedAt = shift.closedAt ? new Date(shift.closedAt) : null;
    const durationMs = closedAt ? closedAt.getTime() - openedAt.getTime() : 0;
    const durationH = Math.floor(durationMs / 3_600_000);
    const durationM = Math.floor((durationMs % 3_600_000) / 60_000);
    const durationStr = closedAt ? `${durationH}h ${durationM}m` : "In progress";

    const bodyData: ShiftCloseBodyData = {
        shiftId:              shift.id,
        status:               shift.status,
        openedAt:             shift.openedAt.toISOString(),
        closedAt:             shift.closedAt ? shift.closedAt.toISOString() : null,
        durationStr,
        cashierName:          shift.user.name,
        counterName:          shift.counter.name,
        tillAccountName:      shift.counter.tillAccount.name,
        branchName:           shift.branch.name,
        notes:                shift.notes,
        openingFloatPaise:    shift.openingFloatPaise.toString(),
        tillMovementPaise:    (tillBookBalancePaise - shift.openingFloatPaise).toString(),
        dropsPaise:           dropsPaise.toString(),
        expectedCashPaise:    shift.expectedCashPaise != null
            ? shift.expectedCashPaise.toString()
            : computeExpectedCash(tillBookBalancePaise, dropsPaise).toString(),
        declaredCashPaise:    shift.declaredCashPaise?.toString() ?? null,
        variancePaise:        shift.variancePaise?.toString() ?? null,
        carryOverNextPaise:   shift.carryOverNextPaise?.toString() ?? null,
        toVaultPaise:         shift.toVaultPaise?.toString() ?? null,
        movementBreakdown: {
            cashSalesPaise:    movementBreakdown.cashSalesPaise.toString(),
            receiptsPaise:     movementBreakdown.receiptsPaise.toString(),
            expendituresPaise: movementBreakdown.expendituresPaise.toString(),
            refundsPaise:      movementBreakdown.refundsPaise.toString(),
            otherPaise:        movementBreakdown.otherPaise.toString(),
        },
        tenderBreakdown: tenderBreakdown.map((t) => ({
            label:       t.label,
            amountPaise: t.amountPaise.toString(),
        })),
        collectionsBreakdown: {
            salesPaise:        collectionsBreakdown.salesPaise.toString(),
            salesCount:        collectionsBreakdown.salesCount,
            receiptsPaise:     collectionsBreakdown.receiptsPaise.toString(),
            receiptsCount:     collectionsBreakdown.receiptsCount,
            refundsPaise:      collectionsBreakdown.refundsPaise.toString(),
            refundsCount:      collectionsBreakdown.refundsCount,
            netCollectedPaise: collectionsBreakdown.netCollectedPaise.toString(),
        },
        closingContraVoucher: closingContra,
        varianceJournalEntry: varianceJE,
        showSignature:        isThermal ? template.showSignatureThermal : template.showSignatureA4,
        cashierSignatureLabel: template.signatureLabel || "Cashier Signature",
        managerSignatureLabel: "Manager Signature",
    };

    const branchAddr = [
        shift.branch.addressLine1,
        shift.branch.addressLine2,
        [shift.branch.city, shift.branch.state, shift.branch.pinCode].filter(Boolean).join(", "),
    ].filter(Boolean).join("\n");

    const sample: ThermalReceiptSample = {
        reference:     `Shift #${shift.id}`,
        date:          formatDateTime(shift.closedAt ?? shift.openedAt),
        partyName:     `${shift.user.name} (${shift.counter.name})`,
        partyPhone:    null,
        lines:         [],
        subtotal:      null,
        taxAmount:     null,
        total:         null,
        notes:         null,
        branchAddress: branchAddr || null,
    };

    const body = (
        <ShiftCloseBody
            data={bodyData}
            thermal={isThermal}
            showSignature={isThermal ? template.showSignatureThermal : template.showSignatureA4}
        />
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
                        ? {
                            endpoint: "/print/voucher",
                            payload: {
                                kind:     "SHIFT_CLOSE",
                                title:    `Shift #${shift.id} Closing Report`,
                                sample,
                                body:     bodyData,
                                template: resolveTemplateForFormat(template, "THERMAL_80MM"),
                            },
                        }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`Shift #${shift.id} Closing Report`}
        />
    );
}
