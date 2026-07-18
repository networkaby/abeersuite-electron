import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { formatDate } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { ShippingSlipBody, type ShippingSlipBodyData } from "@/shared/components/print/ShippingSlipBody";

// Shipping slip / delivery challan for sending a device out to a service centre.
// Prints through the shared template-driven renderer (SHIPPING_SLIP kind, A4 by
// default) following the house print rule: the browser fallback offers the A4 /
// thermal picker and each format renders its own template. The slip-specific
// middle (to/owner + device table + signatures) is the custom `body`; the
// header + footer chrome are shared.

// Snapshot shape written by POST /api/tickets/[id]/shipping-slip.
type ShippingSlip = {
    partyAccountId: number;
    partyName: string;
    ref: string | null;
    date: string;
    device: { type: string; brand: string; model: string; problem: string };
    accessories: string | null;
    condition: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: string | null;
};

export default async function ShippingSlipPage({
    params,
    searchParams,
}: {
    params:        Promise<{ ticketId: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    const { ticketId } = await params;
    const sp = (await searchParams) ?? {};

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(ticketId) },
        include: {
            repair: {
                include: {
                    device: {
                        include: {
                            account: {
                                include: {
                                    person: { include: { phones: selectPrimaryPhone } },
                                    company: { include: { phones: selectPrimaryPhone } },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!ticket?.repair) notFound();

    // Print template — shop header / address / GSTIN / footer, configured on the
    // Print Templates settings page (SHIPPING_SLIP kind).
    const template = await getVoucherTemplate("SHIPPING_SLIP");
    const format = resolvePaperFormat(template, sp.paper);
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    const ctx =
        ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
            ? (ticket.context as Record<string, unknown>)
            : {};
    const slip = ctx.shippingSlip as ShippingSlip | undefined;

    // The device owner (customer) — for reference on the slip.
    const owner = ticket.repair.device.account?.person ?? ticket.repair.device.account?.company;
    const ownerName = owner?.name ?? ticket.repair.device.account?.name ?? "—";
    const ownerPhone = owner?.phones?.[0]?.phone ?? null;

    // The service centre (Sundry-Creditor party) resolved live from the slip's
    // account id — always shows the current name / address / phone.
    let party: { name: string; address: string | null; phone: string | null } | null = null;
    if (slip?.partyAccountId) {
        const acct = await prisma.account.findUnique({
            where: { id: slip.partyAccountId },
            include: {
                person: { include: { phones: selectPrimaryPhone } },
                company: { include: { phones: selectPrimaryPhone } },
            },
        });
        const p = acct?.person ?? acct?.company;
        party = {
            name: acct?.name ?? slip.partyName,
            address: p?.address ?? null,
            phone: p?.phones?.[0]?.phone ?? null,
        };
    }

    const device = slip?.device ?? {
        type: ticket.repair.device.type,
        brand: ticket.repair.device.brand,
        model: ticket.repair.device.model,
        problem: ticket.repair.device.problem,
    };

    const ticketNo = `#${String(ticket.id).padStart(4, "0")}`;

    const sample: ThermalReceiptSample = {
        reference:  ticketNo,
        date:       formatDate(slip?.date ?? ticket.createdAt),
        partyName:  ownerName,
        partyPhone: ownerPhone,
        lines:      [],
        subtotal:   null,
        taxAmount:  null,
        total:      null,
        notes:      null,
    };

    const bodyData: ShippingSlipBodyData = {
        ticketNo,
        date:              formatDate(slip?.date ?? ticket.createdAt),
        ref:               slip?.ref ?? null,
        party,
        partyNameFallback: slip?.partyName ?? null,
        owner:             { name: ownerName, phone: ownerPhone },
        device,
        accessories:       slip?.accessories ?? null,
        condition:         slip?.condition ?? null,
        notes:             slip?.notes ?? null,
        hasSlip:           !!slip,
        preparedBy:        slip?.createdBy ?? null,
    };
    const body = <ShippingSlipBody data={bodyData} />;

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
                            payload:  {
                                kind:     "SHIPPING_SLIP",
                                title:    `Shipping slip ${ticketNo}`,
                                sample,
                                template: resolveTemplateForFormat(template, "THERMAL_80MM"),
                            },
                        }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`Shipping Slip - Ticket ${ticketNo}`}
        />
    );
}
