import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample, ThermalTaxBreakdown } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { isVoucherTemplateKind } from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode, isValidStateCode } from "@/shared/lib/gst/indianStates";

export default async function PosReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ kind?: string; paper?: string; placeOfSupply?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

    // ?kind=POS for counter sales, everything else defaults to SALE.
    const kindParam = sp.kind ?? "SALE";
    const kind = isVoucherTemplateKind(kindParam) ? kindParam : "SALE";

    // ?placeOfSupply=NN — buyer's 2-char state code. The caller computes this
    // from the voucher's `placeOfSupply` column when launching the receipt;
    // POS sales pass the branch state. Anything else falls back to org state
    // → intra-state → single "Tax" row (legacy behaviour).
    const placeOfSupplyParam = (sp.placeOfSupply ?? "").trim();

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
    const partyPhone = owner?.phones[0]?.phone ?? null;

    const [template, org] = await Promise.all([
        getVoucherTemplate(kind),
        getOrganisation(),
    ]);
    // ?paper= override wins; otherwise the kind's stored default.
    const format = resolvePaperFormat(template, sp.paper);

    // Compute CGST/SGST/IGST split for the totals box. Only when a valid
    // place-of-supply was passed; otherwise we render the legacy single
    // "Tax" row (caller didn't compute it — could be a non-GST voucher
    // or a stale call).
    const sellerStateCode = (org.gstStateCode || "").trim();
    let taxBreakdown: ThermalTaxBreakdown | null = null;
    const taxAmt = Number(invoice.taxAmount);
    if (taxAmt > 0 && placeOfSupplyParam && isValidStateCode(placeOfSupplyParam) && sellerStateCode) {
        const split = computeGstSplit({
            taxAmount:       taxAmt,
            sellerStateCode,
            buyerStateCode:  placeOfSupplyParam,
        });
        const placeOfSupplyName = stateNameForCode(placeOfSupplyParam);
        taxBreakdown = split.kind === "INTRA"
            ? { kind: "INTRA", cgst: split.cgst, sgst: split.sgst, placeOfSupplyName }
            : { kind: "INTER", igst: split.igst, placeOfSupplyName };
    }

    const sample: ThermalReceiptSample = {
        reference:  invoice.number,
        date:       invoice.issueDate.toISOString().slice(0, 10),
        partyName,
        partyPhone,
        lines: invoice.lines.map((l) => ({
            description: l.description,
            quantity:    Number(l.quantity),
            amount:      Number(l.amount),
        })),
        subtotal:  Number(invoice.subtotal),
        taxAmount: taxAmt,
        total:     Number(invoice.totalAmount),
        notes:     invoice.notes ?? null,
        taxBreakdown,
    };

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            toolbar={<ReceiptButtons />}
            docTitle={`Invoice ${invoice.number}`}
        />
    );
}
