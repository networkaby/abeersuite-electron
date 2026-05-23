import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { isVoucherTemplateKind } from "@/shared/lib/print/voucherTemplateDefaults";

export default async function PosReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ kind?: string; paper?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

    // ?kind=POS for counter sales, everything else defaults to SALE.
    const kindParam = sp.kind ?? "SALE";
    const kind = isVoucherTemplateKind(kindParam) ? kindParam : "SALE";

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

    const template = await getVoucherTemplate(kind);
    // ?paper= override wins; otherwise the kind's stored default.
    const format = resolvePaperFormat(template, sp.paper);

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
        taxAmount: Number(invoice.taxAmount),
        total:     Number(invoice.totalAmount),
        notes:     invoice.notes ?? null,
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
